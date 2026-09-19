// Native overlay of Virtual Whip (Windows).
//
// Two transparent "layered" windows, always on top, that never take focus:
//   - the whip window, click-through, which draws the rope (Verlet integration)
//     between the anchor point and the cursor;
//   - a small window around the anchor point, the only one that catches the mouse:
//     hold the left button on it and move = move the anchor.
// A sharp mouse gesture triggers the crack (sound + a message sent by the extension;
// nothing is written on screen).
//
// Protocol with the VS Code extension:
//   config : environment variable WHIP_CONFIG (JSON)
//   stdin  : SHOW | HIDE | CRACK | STATUS | QUIT (one command per line)
//   stdout : OVERLAY_READY, WHIP_MESSAGE:<base64 utf8>, WHIP_ANCHOR:<fx>,<fy>
//            and "[overlay] ..." log lines
//
// Built with the csc.exe that ships with Windows (C# 5): see scripts/build-overlay.js

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct SIZE { public int cx, cy; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct BLENDFUNCTION
    {
        public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAPINFOHEADER
    {
        public int biSize, biWidth, biHeight;
        public short biPlanes, biBitCount;
        public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAPINFO
    {
        public BITMAPINFOHEADER bmiHeader;
        public uint bmiColors;
    }

    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
        IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFO pbmi, uint usage, out IntPtr bits, IntPtr section, uint offset);

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern int mciSendString(string command, StringBuilder ret, int retLen, IntPtr callback);
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern bool mciGetErrorString(int error, StringBuilder text, int textLen);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetShortPathName(string longPath, StringBuilder shortPath, int bufferLen);
}

// GDI+ drawing surface backed by a 32-bit DIB: no per-frame copy,
// UpdateLayeredWindow reads the drawn pixels directly.
sealed class Surface : IDisposable
{
    public readonly int Width, Height;
    public readonly IntPtr Dc;
    public readonly Graphics G;
    readonly IntPtr hbmp, oldObj;
    readonly Bitmap bmp;

    public Bitmap Image { get { return bmp; } }

    public Surface(int width, int height)
    {
        Width = Math.Max(1, width);
        Height = Math.Max(1, height);

        Native.BITMAPINFO bi = new Native.BITMAPINFO();
        bi.bmiHeader.biSize = Marshal.SizeOf(typeof(Native.BITMAPINFOHEADER));
        bi.bmiHeader.biWidth = Width;
        bi.bmiHeader.biHeight = -Height; // top-down
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;

        IntPtr screenDc = Native.GetDC(IntPtr.Zero);
        Dc = Native.CreateCompatibleDC(screenDc);
        IntPtr bits;
        hbmp = Native.CreateDIBSection(screenDc, ref bi, 0, out bits, IntPtr.Zero, 0);
        Native.ReleaseDC(IntPtr.Zero, screenDc);
        oldObj = Native.SelectObject(Dc, hbmp);

        bmp = new Bitmap(Width, Height, Width * 4, PixelFormat.Format32bppPArgb, bits);
        G = Graphics.FromImage(bmp);
        G.SmoothingMode = SmoothingMode.AntiAlias;
    }

    public void Dispose()
    {
        G.Dispose();
        bmp.Dispose();
        Native.SelectObject(Dc, oldObj);
        Native.DeleteObject(hbmp);
        Native.DeleteDC(Dc);
    }
}

// Borderless window, never activated, always on top.
// clickThrough = true  : every click goes through (the whip window);
// clickThrough = false : only non-transparent pixels catch the mouse (the anchor point).
sealed class LayerWindow : Form
{
    const int WS_EX_TOPMOST = 0x00000008;
    const int WS_EX_TRANSPARENT = 0x00000020;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_LAYERED = 0x00080000;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const int WM_MOUSEACTIVATE = 0x0021;
    const int WM_LBUTTONDOWN = 0x0201;
    const int MA_NOACTIVATE = 3;

    readonly bool clickThrough;
    bool shown;

    public event Action LeftButtonDown;

    public LayerWindow(bool clickThrough)
    {
        this.clickThrough = clickThrough;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        if (!clickThrough) Cursor = Cursors.SizeAll;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST;
            if (clickThrough) cp.ExStyle |= WS_EX_TRANSPARENT;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_MOUSEACTIVATE)
        {
            m.Result = (IntPtr)MA_NOACTIVATE; // a click must never change the focus
            return;
        }
        if (m.Msg == WM_LBUTTONDOWN && LeftButtonDown != null) LeftButtonDown();
        base.WndProc(ref m);
    }

    public void Present(Surface s, int x, int y, byte alpha)
    {
        Native.POINT dst = new Native.POINT(); dst.X = x; dst.Y = y;
        Native.POINT src = new Native.POINT();
        Native.SIZE size = new Native.SIZE(); size.cx = s.Width; size.cy = s.Height;
        Native.BLENDFUNCTION blend = new Native.BLENDFUNCTION();
        blend.BlendOp = 0;             // AC_SRC_OVER
        blend.SourceConstantAlpha = alpha;
        blend.AlphaFormat = 1;         // AC_SRC_ALPHA (premultiplied pixels)
        Native.UpdateLayeredWindow(Handle, IntPtr.Zero, ref dst, ref size, s.Dc, ref src, 0, ref blend, 2);
        SetShown(true);
    }

    public void SetShown(bool show)
    {
        if (show == shown) return;
        shown = show;
        if (show)
        {
            Native.ShowWindow(Handle, 8); // SW_SHOWNOACTIVATE
            // HWND_TOPMOST, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            Native.SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        }
        else
        {
            Native.ShowWindow(Handle, 0); // SW_HIDE
        }
    }
}

sealed class Overlay : ApplicationContext
{
    // ---------- Physics settings ----------
    const int CONSTRAINT_ITERATIONS = 10;
    const double PHYSICS_STEP_MS = 1000.0 / 60.0;

    const double DEFAULT_MAX_LENGTH = 450;   // px
    const double MIN_MAX_LENGTH = 120;
    const double MAX_MAX_LENGTH = 3000;
    const double REACH_FACTOR = 0.985;       // the tip never goes beyond 98.5% of the rope length

    const double MIN_CRACK_SPEED = 3.5;      // px/ms
    const double MIN_CRACK_DISTANCE = 90;    // px
    const double MAX_CRACK_DURATION = 120;   // ms
    const double SAMPLE_WINDOW_MS = 150;
    const int ANCHOR_MARGIN = 60;
    const int PEG_WINDOW = 56;               // side of the anchor point window
    const int PEG_GRAB_RADIUS = 26;          // grab radius around the anchor point
    const int VK_LBUTTON = 0x01;

    struct Node { public double x, y, px, py; }
    struct Sample { public double x, y, t; }

    readonly LayerWindow whip = new LayerWindow(true);
    readonly LayerWindow peg = new LayerWindow(false);
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly Random rng = new Random();
    readonly StreamWriter stdout;

    readonly List<string> messages = new List<string>();
    readonly double sensitivity = 3.5;
    readonly double maxLength = DEFAULT_MAX_LENGTH;
    readonly string anchorPosition = "bottom-right";
    bool hasCustomAnchor;
    double customFx, customFy;
    bool audioReady;
    System.Media.SoundPlayer fallbackPlayer;

    // ---------- Appearance and behavior (defaults = the "leather" style) ----------
    // Replaced by the "appearance" section of WHIP_CONFIG, already resolved by the extension.
    Color whipBase = Color.FromArgb(0x78, 0x50, 0x32);
    Color whipTip = Color.FromArgb(0xD2, 0xA0, 0x64);
    double whipOpacity = 0.9, whipThickness = 7, whipTipThickness = 2, whipGlow = 0;
    double gravity = 0.35, damping = 0.985;
    Color pegColor = Color.FromArgb(0x3C, 0x2D, 0x1E);
    double pegSize = 9;
    bool effectEnabled = true;
    Color effectColor = Color.FromArgb(0xFF, 0xE6, 0xB4);
    double effectSize = 1, effectDuration = 380;
    int effectRays = 8;
    double cooldownMs = 650;
    int volume = 100;

    readonly int segments;
    readonly Node[] chain;
    readonly double[] segmentLengths;
    readonly List<Sample> samples = new List<Sample>();

    bool visible;
    Rectangle currentScreen = Rectangle.Empty;
    PointF anchor;
    PointF tip;
    Point lastCursor = new Point(int.MinValue, int.MinValue);
    double lastTick, accumulator, lastCrack = -1e9;

    bool dragging, prevLeftDown;
    double grabDx, grabDy;
    PointF pegShownAt = new PointF(float.NaN, float.NaN);

    bool burstActive;
    double burstX, burstY, burstStart;

    Surface whipSurface;
    readonly Surface pegSurface;

    // snapshotOnly: "--snapshot" mode (renders to a PNG: no window, no sound, no standard input).
    public Overlay(bool snapshotOnly)
    {
        Stream so = Console.OpenStandardOutput();
        stdout = new StreamWriter(so, new UTF8Encoding(false));
        stdout.AutoFlush = true;
        stdout.NewLine = "\n";

        string audioPath = "";
        try
        {
            string json = Environment.GetEnvironmentVariable("WHIP_CONFIG");
            if (!string.IsNullOrEmpty(json))
            {
                Dictionary<string, object> cfg =
                    new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                if (cfg != null)
                {
                    object v;
                    if (cfg.TryGetValue("sensitivity", out v) && v != null) sensitivity = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                    if (cfg.TryGetValue("maxLength", out v) && v != null) maxLength = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                    if (cfg.TryGetValue("anchorPosition", out v) && v != null) anchorPosition = v.ToString();
                    if (cfg.TryGetValue("audioFilePath", out v) && v != null) audioPath = v.ToString();
                    if (cfg.TryGetValue("messages", out v) && v is IEnumerable)
                    {
                        foreach (object m in (IEnumerable)v)
                        {
                            if (m != null && m.ToString().Length > 0) messages.Add(m.ToString());
                        }
                    }
                    if (cfg.TryGetValue("volume", out v) && v != null) volume = (int)Clamp(Convert.ToDouble(v, CultureInfo.InvariantCulture), 0, 100);
                    if (cfg.TryGetValue("cooldownMs", out v) && v != null) cooldownMs = Clamp(Convert.ToDouble(v, CultureInfo.InvariantCulture), 100, 5000);
                    if (cfg.TryGetValue("appearance", out v)) ReadAppearance(v as Dictionary<string, object>);
                    if (cfg.TryGetValue("anchorCustom", out v))
                    {
                        Dictionary<string, object> a = v as Dictionary<string, object>;
                        object ax, ay;
                        if (a != null && a.TryGetValue("x", out ax) && a.TryGetValue("y", out ay) && ax != null && ay != null)
                        {
                            customFx = Clamp(Convert.ToDouble(ax, CultureInfo.InvariantCulture), 0, 1);
                            customFy = Clamp(Convert.ToDouble(ay, CultureInfo.InvariantCulture), 0, 1);
                            hasCustomAnchor = true;
                        }
                    }
                }
            }
        }
        catch (Exception e)
        {
            Log("invalid WHIP_CONFIG: " + e.Message);
        }
        if (messages.Count == 0) messages.Add("Come on, faster!");
        maxLength = Clamp(maxLength, MIN_MAX_LENGTH, MAX_MAX_LENGTH);

        // Rope: total length = maxLength, segments longer at the base and finer at the tip.
        segments = (int)Clamp(Math.Round(maxLength / 26.0), 10, 40);
        chain = new Node[segments];
        segmentLengths = new double[segments - 1];
        double sum = 0;
        for (int i = 0; i < segments - 1; i++)
        {
            segmentLengths[i] = Lerp(24, 9, i / (double)(segments - 2));
            sum += segmentLengths[i];
        }
        for (int i = 0; i < segments - 1; i++) segmentLengths[i] *= maxLength / sum;

        pegSurface = new Surface(PEG_WINDOW, PEG_WINDOW);
        DrawPeg(pegSurface.G);
        if (snapshotOnly) return;

        InitAudio(audioPath);
        Log("config: sensitivity=" + sensitivity + ", maxLength=" + maxLength + ", anchor=" +
            (hasCustomAnchor ? "custom(" + customFx.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                customFy.ToString("0.###", CultureInfo.InvariantCulture) + ")" : anchorPosition) +
            ", audio=" + (audioReady ? "mci" : (fallbackPlayer != null ? "soundplayer" : "none")) +
            ", volume=" + volume + ", cooldownMs=" + cooldownMs + ", messages=" + messages.Count);

        peg.LeftButtonDown += BeginDrag;

        // Force the creation of the handles (needed for BeginInvoke from the stdin thread).
        IntPtr h1 = whip.Handle;
        IntPtr h2 = peg.Handle;

        timer.Interval = 8;
        timer.Tick += OnTick;
        timer.Start();

        Thread reader = new Thread(ReadCommands);
        reader.IsBackground = true;
        reader.Start();

        stdout.WriteLine("OVERLAY_READY");
    }

    // ---------- Appearance configuration ----------

    static double Num(Dictionary<string, object> d, string key, double fallback, double lo, double hi)
    {
        object v;
        if (d == null || !d.TryGetValue(key, out v) || v == null) return fallback;
        try { return Clamp(Convert.ToDouble(v, CultureInfo.InvariantCulture), lo, hi); }
        catch (Exception) { return fallback; }
    }

    static Color HexColor(Dictionary<string, object> d, string key, Color fallback)
    {
        object v;
        if (d == null || !d.TryGetValue(key, out v) || v == null) return fallback;
        return ParseHex(v.ToString(), fallback);
    }

    // "#RGB" or "#RRGGBB" color; any other value yields the fallback color.
    public static Color ParseHex(string text, Color fallback)
    {
        string s = text.Trim();
        if (s.StartsWith("#")) s = s.Substring(1);
        try
        {
            if (s.Length == 3) s = "" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
            if (s.Length != 6) return fallback;
            return Color.FromArgb(
                int.Parse(s.Substring(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture),
                int.Parse(s.Substring(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture),
                int.Parse(s.Substring(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
        }
        catch (Exception) { return fallback; }
    }

    static Dictionary<string, object> Section(Dictionary<string, object> d, string key)
    {
        object v;
        return d != null && d.TryGetValue(key, out v) ? v as Dictionary<string, object> : null;
    }

    void ReadAppearance(Dictionary<string, object> a)
    {
        if (a == null) return;
        Dictionary<string, object> w = Section(a, "whip");
        whipBase = HexColor(w, "colorBase", whipBase);
        whipTip = HexColor(w, "colorTip", whipTip);
        whipOpacity = Num(w, "opacity", whipOpacity, 0.1, 1);
        whipThickness = Num(w, "thickness", whipThickness, 1, 30);
        whipTipThickness = Num(w, "tipThickness", whipTipThickness, 1, 20);
        whipGlow = Num(w, "glow", whipGlow, 0, 1);
        gravity = Num(w, "gravity", gravity, 0, 1.5);
        damping = Num(w, "damping", damping, 0.9, 0.999);

        Dictionary<string, object> p = Section(a, "anchor");
        pegColor = HexColor(p, "color", pegColor);
        pegSize = Num(p, "size", pegSize, 4, 20);

        Dictionary<string, object> e = Section(a, "effect");
        object en;
        if (e != null && e.TryGetValue("enabled", out en) && en is bool) effectEnabled = (bool)en;
        effectColor = HexColor(e, "color", effectColor);
        effectSize = Num(e, "size", effectSize, 0.3, 3);
        effectDuration = Num(e, "durationMs", effectDuration, 100, 2000);
        effectRays = (int)Num(e, "rays", effectRays, 0, 24);
    }

    // ---------- Utilities ----------

    static Color Mix(Color a, Color b, double t)
    {
        return Color.FromArgb(
            (int)Math.Round(Lerp(a.R, b.R, t)),
            (int)Math.Round(Lerp(a.G, b.G, t)),
            (int)Math.Round(Lerp(a.B, b.B, t)));
    }

    static double Lerp(double a, double b, double t) { return a + (b - a) * t; }
    static double Clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
    static int RoundUp(int v) { return ((v + 255) / 256) * 256; }

    void Log(string message)
    {
        stdout.WriteLine("[overlay] " + message);
    }

    // ---------- Commands (stdin thread -> UI thread) ----------

    void ReadCommands()
    {
        try
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                string command = line.Trim();
                if (command.Length == 0) continue;
                whip.BeginInvoke(new Action(delegate { HandleCommand(command); }));
            }
        }
        catch (Exception e)
        {
            Log("stdin reader stopped: " + e.Message);
            return;
        }
        // stdin closed: the extension is gone, so we stop too.
        whip.BeginInvoke(new Action(delegate { Shutdown(); }));
    }

    void HandleCommand(string command)
    {
        switch (command)
        {
            case "SHOW":
                if (!visible)
                {
                    visible = true;
                    currentScreen = Rectangle.Empty; // forces the anchor to be recomputed
                    lastTick = clock.Elapsed.TotalMilliseconds;
                    accumulator = 0;
                    samples.Clear();
                }
                Log("showing overlay");
                break;
            case "HIDE":
                visible = false;
                dragging = false;
                whip.SetShown(false);
                peg.SetShown(false);
                pegShownAt = new PointF(float.NaN, float.NaN);
                burstActive = false;
                Log("hiding overlay");
                break;
            case "CRACK":
                if (visible) FireCrack(clock.Elapsed.TotalMilliseconds);
                break;
            case "STATUS":
                Log("status visible=" + visible + " dragging=" + dragging + " cursor=" + lastCursor.X + "," + lastCursor.Y +
                    " tip=" + (int)tip.X + "," + (int)tip.Y + " anchor=" + (int)anchor.X + "," + (int)anchor.Y +
                    " maxLength=" + (int)maxLength + " segments=" + segments + " screen=" + currentScreen +
                    " surface=" + (whipSurface == null ? "none" : whipSurface.Width + "x" + whipSurface.Height));
                break;
            case "QUIT":
                Shutdown();
                break;
        }
    }

    void Shutdown()
    {
        timer.Stop();
        if (audioReady) Native.mciSendString("close whipcrack", null, 0, IntPtr.Zero);
        whip.Close();
        peg.Close();
        ExitThread();
    }

    // ---------- Audio (MCI: wav and mp3, no dependency) ----------

    void InitAudio(string path)
    {
        if (string.IsNullOrEmpty(path) || volume <= 0) return; // volume 0 = muted
        if (!File.Exists(path))
        {
            Log("audio file not found: " + path);
            return;
        }

        // MCI rejects some long or non-ASCII paths: give it the short 8.3 path when there is one.
        string mciPath = path;
        StringBuilder shortPath = new StringBuilder(1024);
        if (Native.GetShortPathName(path, shortPath, shortPath.Capacity) > 0) mciPath = shortPath.ToString();

        string type = path.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) ? " type mpegvideo" : "";
        int result = Native.mciSendString("open \"" + mciPath + "\"" + type + " alias whipcrack", null, 0, IntPtr.Zero);
        audioReady = result == 0;
        if (audioReady)
        {
            // MCI volume ranges from 0 to 1000.
            Native.mciSendString("setaudio whipcrack volume to " + (volume * 10), null, 0, IntPtr.Zero);
            return;
        }

        StringBuilder text = new StringBuilder(256);
        Native.mciGetErrorString(result, text, text.Capacity);
        Log("MCI cannot open audio file (" + result + ": " + text + ")");

        // SoundPlayer cannot set the volume: fall back to it only at volume 100.
        if (volume >= 100 && path.EndsWith(".wav", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                fallbackPlayer = new System.Media.SoundPlayer(path);
                fallbackPlayer.Load();
            }
            catch (Exception e)
            {
                fallbackPlayer = null;
                Log("SoundPlayer cannot load audio file: " + e.Message);
            }
        }
    }

    void PlayAudio()
    {
        if (audioReady)
        {
            Native.mciSendString("seek whipcrack to start", null, 0, IntPtr.Zero);
            Native.mciSendString("play whipcrack", null, 0, IntPtr.Zero);
        }
        else if (fallbackPlayer != null)
        {
            fallbackPlayer.Play();
        }
    }

    // ---------- Anchor ----------

    PointF ComputeAnchor(Rectangle screen)
    {
        if (hasCustomAnchor)
        {
            return new PointF((float)(screen.Left + customFx * screen.Width), (float)(screen.Top + customFy * screen.Height));
        }
        switch (anchorPosition)
        {
            case "bottom-left": return new PointF(screen.Left + ANCHOR_MARGIN, screen.Bottom - ANCHOR_MARGIN);
            case "top-right": return new PointF(screen.Right - ANCHOR_MARGIN, screen.Top + ANCHOR_MARGIN);
            case "top-left": return new PointF(screen.Left + ANCHOR_MARGIN, screen.Top + ANCHOR_MARGIN);
            default: return new PointF(screen.Right - ANCHOR_MARGIN, screen.Bottom - ANCHOR_MARGIN);
        }
    }

    // Left click on the anchor point: it is held for as long as the button stays down.
    void BeginDrag()
    {
        if (!visible || dragging) return;
        Native.POINT cp;
        Native.GetCursorPos(out cp);
        grabDx = anchor.X - cp.X;
        grabDy = anchor.Y - cp.Y;
        dragging = true;
        samples.Clear();
        Log("anchor drag started");
    }

    void EndDrag(double now)
    {
        dragging = false;
        samples.Clear();
        lastCrack = now; // the dragging gesture must not crack the whip
        if (currentScreen.Width <= 0 || currentScreen.Height <= 0) return;

        customFx = Clamp((anchor.X - currentScreen.Left) / currentScreen.Width, 0, 1);
        customFy = Clamp((anchor.Y - currentScreen.Top) / currentScreen.Height, 0, 1);
        hasCustomAnchor = true;
        stdout.WriteLine("WHIP_ANCHOR:" + customFx.ToString("0.####", CultureInfo.InvariantCulture) + "," +
            customFy.ToString("0.####", CultureInfo.InvariantCulture));
        Log("anchor drag ended at " + (int)anchor.X + "," + (int)anchor.Y);
    }

    // ---------- Rope ----------

    void ResetChain()
    {
        for (int i = 0; i < segments; i++)
        {
            chain[i].x = chain[i].px = anchor.X;
            chain[i].y = chain[i].py = anchor.Y;
        }
    }

    // The tip follows the cursor, but never farther than the length of the rope.
    PointF ReachableTip(Native.POINT cursor)
    {
        double dx = cursor.X - anchor.X;
        double dy = cursor.Y - anchor.Y;
        double dist = Math.Sqrt(dx * dx + dy * dy);
        double reach = maxLength * REACH_FACTOR;
        if (dist <= reach || dist < 0.0001) return new PointF(cursor.X, cursor.Y);
        return new PointF((float)(anchor.X + dx / dist * reach), (float)(anchor.Y + dy / dist * reach));
    }

    void StepPhysics()
    {
        int last = segments - 1;
        for (int i = 1; i < last; i++)
        {
            double vx = (chain[i].x - chain[i].px) * damping;
            double vy = (chain[i].y - chain[i].py) * damping;
            chain[i].px = chain[i].x;
            chain[i].py = chain[i].y;
            chain[i].x += vx;
            chain[i].y += vy + gravity;
        }

        chain[0].x = anchor.X;
        chain[0].y = anchor.Y;
        chain[last].x = tip.X;
        chain[last].y = tip.Y;

        for (int iter = 0; iter < CONSTRAINT_ITERATIONS; iter++)
        {
            for (int i = 0; i < last; i++)
            {
                int j = i + 1;
                double dx = chain[j].x - chain[i].x;
                double dy = chain[j].y - chain[i].y;
                double dist = Math.Sqrt(dx * dx + dy * dy);
                if (dist < 0.0001) dist = 0.0001;
                double diff = (dist - segmentLengths[i]) / dist;
                double offX = dx * 0.5 * diff;
                double offY = dy * 0.5 * diff;
                bool p1Fixed = i == 0;
                bool p2Fixed = j == last;

                if (p1Fixed && p2Fixed) continue;
                if (p1Fixed)
                {
                    chain[j].x -= offX * 2;
                    chain[j].y -= offY * 2;
                }
                else if (p2Fixed)
                {
                    chain[i].x += offX * 2;
                    chain[i].y += offY * 2;
                }
                else
                {
                    chain[i].x += offX;
                    chain[i].y += offY;
                    chain[j].x -= offX;
                    chain[j].y -= offY;
                }
            }
        }
    }

    // ---------- Gesture (cursor speed) ----------

    bool EvaluateGesture()
    {
        if (samples.Count < 3) return false;
        double totalLen = 0;
        double maxSpeed = 0;
        for (int i = 1; i < samples.Count; i++)
        {
            double dx = samples[i].x - samples[i - 1].x;
            double dy = samples[i].y - samples[i - 1].y;
            double dist = Math.Sqrt(dx * dx + dy * dy);
            totalLen += dist;
            double dt = samples[i].t - samples[i - 1].t;
            if (dt > 0)
            {
                double speed = dist / dt;
                if (speed > maxSpeed) maxSpeed = speed;
            }
        }
        double duration = samples[samples.Count - 1].t - samples[0].t;
        double threshold = Math.Max(MIN_CRACK_SPEED, sensitivity);
        return totalLen >= MIN_CRACK_DISTANCE && duration <= MAX_CRACK_DURATION && maxSpeed >= threshold;
    }

    void FireCrack(double now)
    {
        lastCrack = now;
        burstActive = effectEnabled;
        burstX = tip.X;
        burstY = tip.Y;
        burstStart = now;
        samples.Clear(); // a new movement is needed for the next crack
        PlayAudio();

        // The message goes to Claude Code / Copilot through the extension; nothing is shown on screen.
        string message = messages[rng.Next(messages.Count)];
        Log("crack triggered");
        stdout.WriteLine("WHIP_MESSAGE:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(message)));
    }

    // ---------- Main loop ----------

    void OnTick(object sender, EventArgs e)
    {
        if (!visible) return;
        double now = clock.Elapsed.TotalMilliseconds;

        Native.POINT cursor;
        Native.GetCursorPos(out cursor);

        // Safety net: if Windows did not deliver the click to the anchor point window
        // (it depends on the foreground window), detect the press ourselves.
        bool leftDown = (Native.GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
        if (leftDown && !prevLeftDown && !dragging)
        {
            double pdx = cursor.X - anchor.X, pdy = cursor.Y - anchor.Y;
            if (pdx * pdx + pdy * pdy <= PEG_GRAB_RADIUS * PEG_GRAB_RADIUS) BeginDrag();
        }
        prevLeftDown = leftDown;

        if (dragging)
        {
            if (!leftDown)
            {
                EndDrag(now);
            }
            else
            {
                anchor = new PointF(
                    (float)Clamp(cursor.X + grabDx, currentScreen.Left + 16, currentScreen.Right - 16),
                    (float)Clamp(cursor.Y + grabDy, currentScreen.Top + 16, currentScreen.Bottom - 16));
            }
        }
        else
        {
            Rectangle screen = Screen.FromPoint(new Point(cursor.X, cursor.Y)).Bounds;
            if (screen != currentScreen)
            {
                currentScreen = screen;
                anchor = ComputeAnchor(screen);
                ResetChain();
            }
        }
        tip = ReachableTip(cursor);

        // Like a "mousemove" event: only sample when the cursor has moved.
        if (!dragging && (cursor.X != lastCursor.X || cursor.Y != lastCursor.Y))
        {
            Sample s = new Sample(); s.x = cursor.X; s.y = cursor.Y; s.t = now;
            samples.Add(s);
        }
        lastCursor = new Point(cursor.X, cursor.Y);
        while (samples.Count > 0 && now - samples[0].t > SAMPLE_WINDOW_MS) samples.RemoveAt(0);

        // Fixed-step physics (60 Hz), whatever the timer rate.
        accumulator += now - lastTick;
        lastTick = now;
        if (accumulator > 4 * PHYSICS_STEP_MS) accumulator = 4 * PHYSICS_STEP_MS;
        while (accumulator >= PHYSICS_STEP_MS)
        {
            StepPhysics();
            accumulator -= PHYSICS_STEP_MS;
        }

        if (!dragging && now - lastCrack > cooldownMs && EvaluateGesture())
        {
            FireCrack(now);
        }

        RenderWhip(now);
        RenderPeg();
    }

    // ---------- Rendering ----------

    void RenderWhip(double now)
    {
        if (burstActive && now - burstStart > effectDuration) burstActive = false;

        double minX = anchor.X, maxX = anchor.X, minY = anchor.Y, maxY = anchor.Y;
        for (int i = 0; i < segments; i++)
        {
            if (chain[i].x < minX) minX = chain[i].x;
            if (chain[i].x > maxX) maxX = chain[i].x;
            if (chain[i].y < minY) minY = chain[i].y;
            if (chain[i].y > maxY) maxY = chain[i].y;
        }
        if (burstActive)
        {
            double reach = 90 * effectSize;
            minX = Math.Min(minX, burstX - reach); maxX = Math.Max(maxX, burstX + reach);
            minY = Math.Min(minY, burstY - reach); maxY = Math.Max(maxY, burstY + reach);
        }

        // margin: stroke thickness + optional glow
        int pad = 24 + (int)Math.Ceiling(whipThickness * 1.7 + 8 * whipGlow);
        int x0 = (int)Math.Floor(minX) - pad;
        int y0 = (int)Math.Floor(minY) - pad;
        int w = (int)Math.Ceiling(maxX) + pad - x0;
        int h = (int)Math.Ceiling(maxY) + pad - y0;

        if (whipSurface == null || whipSurface.Width < w || whipSurface.Height < h ||
            whipSurface.Width > w + 768 || whipSurface.Height > h + 768)
        {
            if (whipSurface != null) whipSurface.Dispose();
            whipSurface = new Surface(RoundUp(w), RoundUp(h));
        }

        Graphics g = whipSurface.G;
        g.ResetTransform();
        g.Clear(Color.Transparent);
        g.TranslateTransform(-x0, -y0);

        DrawChain(g);
        if (burstActive) DrawBurst(g, now);

        // Opacity applies to the whole window: the stroke is drawn opaque (no "beads" at the
        // joints) and then made translucent in one go.
        whip.Present(whipSurface, x0, y0, (byte)Math.Round(whipOpacity * 255));
    }

    const int SMOOTH_STEPS = 4; // sub-segments drawn between two rope nodes

    // Smooth curve (Catmull-Rom) through the rope nodes: the physics stays on a few
    // segments, but the drawing no longer shows any visible angle.
    // ts[i]: position along the rope, from 0 (base) to 1 (tip).
    void BuildSmoothPath(out PointF[] points, out double[] ts)
    {
        int count = (segments - 1) * SMOOTH_STEPS + 1;
        points = new PointF[count];
        ts = new double[count];
        int n = 0;
        for (int i = 0; i < segments - 1; i++)
        {
            Node p0 = chain[Math.Max(i - 1, 0)], p1 = chain[i], p2 = chain[i + 1], p3 = chain[Math.Min(i + 2, segments - 1)];
            for (int s = 0; s < SMOOTH_STEPS; s++)
            {
                double u = s / (double)SMOOTH_STEPS, u2 = u * u, u3 = u2 * u;
                double x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
                double y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3);
                points[n] = new PointF((float)x, (float)y);
                ts[n] = (i + u) / (segments - 1);
                n++;
            }
        }
        points[n] = new PointF((float)chain[segments - 1].x, (float)chain[segments - 1].y);
        ts[n] = 1;
    }

    void DrawChain(Graphics g)
    {
        PointF[] points;
        double[] ts;
        BuildSmoothPath(out points, out ts);

        // Glow: two translucent single-stroke passes along the whole rope.
        if (whipGlow > 0.001)
        {
            double average = (whipThickness + whipTipThickness) / 2;
            Color glowColor = Mix(whipBase, whipTip, 0.5);
            DrawGlowPass(g, points, glowColor, (float)(average * 3.4 + 8 * whipGlow), (int)Math.Round(255 * 0.10 * whipGlow));
            DrawGlowPass(g, points, glowColor, (float)(average * 2.0 + 4 * whipGlow), (int)Math.Round(255 * 0.18 * whipGlow));
        }

        using (Pen pen = new Pen(Color.White, 2f))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            for (int i = 0; i < points.Length - 1; i++)
            {
                double t = (ts[i] + ts[i + 1]) / 2;
                pen.Color = Mix(whipBase, whipTip, t);
                pen.Width = (float)Lerp(whipThickness, whipTipThickness, t);
                g.DrawLine(pen, points[i], points[i + 1]);
            }
        }
    }

    static void DrawGlowPass(Graphics g, PointF[] points, Color color, float width, int alpha)
    {
        using (Pen pen = new Pen(Color.FromArgb(Math.Max(0, Math.Min(255, alpha)), color), width))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            pen.LineJoin = LineJoin.Round;
            g.DrawLines(pen, points);
        }
    }

    // Anchor point: drawn in its own window, the only one that catches the mouse.
    // The almost transparent disc (alpha 8) makes a comfortable grab area.
    void DrawPeg(Graphics g)
    {
        float c = PEG_WINDOW / 2f;
        float r = (float)pegSize;
        g.Clear(Color.Transparent);
        using (Brush grab = new SolidBrush(Color.FromArgb(8, 255, 255, 255)))
        using (Brush fill = new SolidBrush(Color.FromArgb(230, pegColor)))
        using (Pen ring = new Pen(Color.FromArgb(179, Mix(pegColor, Color.Black, 0.45)), 2f))
        {
            g.FillEllipse(grab, 1, 1, PEG_WINDOW - 2, PEG_WINDOW - 2);
            g.FillEllipse(fill, c - r, c - r, 2 * r, 2 * r);
            g.DrawEllipse(ring, c - r - 4, c - r - 4, 2 * (r + 4), 2 * (r + 4));
        }
    }

    void RenderPeg()
    {
        if (anchor.X == pegShownAt.X && anchor.Y == pegShownAt.Y) return;
        pegShownAt = anchor;
        peg.Present(pegSurface, (int)Math.Round(anchor.X) - PEG_WINDOW / 2, (int)Math.Round(anchor.Y) - PEG_WINDOW / 2, 255);
    }

    void DrawBurst(Graphics g, double now)
    {
        DrawBurstAt(g, burstX, burstY, (now - burstStart) / effectDuration);
    }

    // t: progress of the effect, from 0 (start) to 1 (end).
    void DrawBurstAt(Graphics g, double cx, double cy, double t)
    {
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        double radius = (8 + t * 46) * effectSize;
        int alpha = (int)Math.Round((1 - t) * 255);

        using (Pen circle = new Pen(Color.FromArgb((int)Math.Round(alpha * 0.8), effectColor), (float)Math.Max(1.5, 3 * Math.Sqrt(effectSize))))
        {
            g.DrawEllipse(circle, (float)(cx - radius), (float)(cy - radius), (float)(radius * 2), (float)(radius * 2));
        }

        if (effectRays <= 0) return;
        using (Pen ray = new Pen(Color.FromArgb(alpha, effectColor), (float)Math.Max(1.2, 2 * Math.Sqrt(effectSize))))
        {
            double len = (14 + t * 30) * effectSize;
            for (int i = 0; i < effectRays; i++)
            {
                double angle = (Math.PI * 2 * i) / effectRays + t * 1.5;
                double x1 = cx + Math.Cos(angle) * radius * 0.5;
                double y1 = cy + Math.Sin(angle) * radius * 0.5;
                double x2 = cx + Math.Cos(angle) * (radius * 0.5 + len);
                double y2 = cy + Math.Sin(angle) * (radius * 0.5 + len);
                g.DrawLine(ray, (float)x1, (float)y1, (float)x2, (float)y2);
            }
        }
    }

    // ---------- Off-screen rendering (style gallery, visual tests) ----------

    // Draws a demo scene (slack rope, crack effect, anchor point) into a PNG,
    // without opening a single window.
    public void RenderSnapshot(string path, int width, int height, Color background)
    {
        // Composition proportional to the frame: anchor bottom-left, cursor top-right.
        // If maxLength is longer than the distance between them, the rope sags into a curve.
        anchor = new PointF(width * 0.09f, height * 0.62f);
        currentScreen = new Rectangle(0, 0, width, height);
        Native.POINT cursor = new Native.POINT();
        cursor.X = (int)Math.Round(width * 0.88);
        cursor.Y = (int)Math.Round(height * 0.14);
        ResetChain();
        tip = ReachableTip(cursor);
        for (int i = 0; i < 400; i++) StepPhysics();

        using (Bitmap output = new Bitmap(width, height, PixelFormat.Format32bppPArgb))
        using (Graphics g = Graphics.FromImage(output))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(background);

            // The rope and the effect are drawn opaque on a layer, then composited with the opacity.
            using (Bitmap layer = new Bitmap(width, height, PixelFormat.Format32bppPArgb))
            using (Graphics lg = Graphics.FromImage(layer))
            {
                lg.SmoothingMode = SmoothingMode.AntiAlias;
                DrawChain(lg);
                if (effectEnabled) DrawBurstAt(lg, tip.X, tip.Y, 0.3);
                ColorMatrix matrix = new ColorMatrix();
                matrix.Matrix33 = (float)whipOpacity;
                using (ImageAttributes attributes = new ImageAttributes())
                {
                    attributes.SetColorMatrix(matrix);
                    g.DrawImage(layer, new Rectangle(0, 0, width, height), 0, 0, width, height, GraphicsUnit.Pixel, attributes);
                }
            }
            g.DrawImage(pegSurface.Image, anchor.X - PEG_WINDOW / 2f, anchor.Y - PEG_WINDOW / 2f);
            output.Save(path, ImageFormat.Png);
        }
    }
}

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        Thread.CurrentThread.CurrentCulture = CultureInfo.InvariantCulture;
        try
        {
            // Coordinates in physical pixels, even with several screens at different scales.
            Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
        }
        catch (Exception) { }

        int snapshot = Array.IndexOf(args, "--snapshot");
        if (snapshot >= 0 && snapshot + 1 < args.Length) return Snapshot(args, args[snapshot + 1]);

        Application.Run(new Overlay(false));
        return 0;
    }

    // WhipOverlay.exe --snapshot output.png [--size 640x360] [--bg #1E1E1E]
    // The configuration is read from WHIP_CONFIG, as for the normal overlay.
    static int Snapshot(string[] args, string path)
    {
        try
        {
            int width = 640, height = 360;
            Color background = Color.FromArgb(0x1E, 0x1E, 0x1E);
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--size")
                {
                    string[] parts = args[i + 1].ToLowerInvariant().Split('x');
                    if (parts.Length == 2)
                    {
                        width = Math.Max(64, Math.Min(4096, int.Parse(parts[0], CultureInfo.InvariantCulture)));
                        height = Math.Max(64, Math.Min(4096, int.Parse(parts[1], CultureInfo.InvariantCulture)));
                    }
                }
                else if (args[i] == "--bg")
                {
                    background = Overlay.ParseHex(args[i + 1], background);
                }
            }
            new Overlay(true).RenderSnapshot(path, width, height, background);
            return 0;
        }
        catch (Exception e)
        {
            File.WriteAllText(path + ".err", e.ToString());
            return 1;
        }
    }
}
