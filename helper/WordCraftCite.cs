// Instant Cite WordCraft helper.
//
// WordCraft 0.10.0 offers no keyboard binding for its Zotero commands: they exist only as
// ribbon buttons. This helper gives "Add/Edit Citation" a key anyway. While a WordCraft window
// is in the foreground it registers a global hotkey; when the key is pressed it presses the
// ribbon button through UI Automation (Zotero tab, Add/Edit Citation) and then puts the
// previously active ribbon tab back. Outside WordCraft the key is left alone.
//
// Usage:
//   WordCraftCite.exe [--key Ctrl+Shift+I] [--parent PID] [--log FILE] [--stay]
//   WordCraftCite.exe --probe   lists WordCraft's ribbon without pressing anything
//   WordCraftCite.exe --cite    presses Add/Edit Citation once in the WordCraft window
//
// Built with the .NET Framework compiler that ships with Windows (see build.cmd).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

static class Program
{
    const string ProcessName = "wordcraft";
    const string ZoteroTab = "Zotero";

    static string logPath;
    static bool stayOnZotero;

    [STAThread]
    static int Main(string[] args)
    {
        string key = "Ctrl+Shift+I";
        int parentPid = 0;
        bool probe = false, citeOnce = false;
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--key" && i + 1 < args.Length) key = args[++i];
            else if (a == "--parent" && i + 1 < args.Length) int.TryParse(args[++i], out parentPid);
            else if (a == "--log" && i + 1 < args.Length) logPath = args[++i];
            else if (a == "--stay") stayOnZotero = true;
            else if (a == "--probe") probe = true;
            else if (a == "--cite") citeOnce = true;
        }

        if (probe) return Probe();
        if (citeOnce)
        {
            IntPtr hwnd = FindWordCraftWindow();
            if (hwnd == IntPtr.Zero) { Console.Error.WriteLine("WordCraft is not running."); return 2; }
            return Ribbon.PressCitation(hwnd, stayOnZotero) ? 0 : 1;
        }

        uint mods, vk;
        if (!Hotkey.TryParse(key, out mods, out vk))
        {
            Log("Cannot use the key " + key + ".");
            return 2;
        }

        bool created;
        using (var mutex = new Mutex(true, "Local\\InstantCiteWordCraftHelper", out created))
        {
            // A restart can get here while the instance it replaced is still dying.
            if (!created && !Acquire(mutex))
            {
                Log("Another helper is already running; exiting.");
                return 0;
            }
            Log("Started with key " + key + (parentPid > 0 ? ", parent " + parentPid : "") + ".");
            if (parentPid > 0 && !WatchParent(parentPid)) return 0;
            using (var hotkey = new Hotkey(mods, vk, key))
                Application.Run();
            Log("Stopped.");
        }
        return 0;
    }

    static bool Acquire(Mutex mutex)
    {
        try { return mutex.WaitOne(3000); }
        catch (AbandonedMutexException) { return true; }
    }

    // Exit together with the program that started the helper (Zotero).
    static bool WatchParent(int pid)
    {
        Process parent;
        try { parent = Process.GetProcessById(pid); }
        catch (ArgumentException) { Log("Parent " + pid + " is gone; exiting."); return false; }
        var timer = new System.Windows.Forms.Timer { Interval = 2000 };
        timer.Tick += delegate
        {
            if (!parent.HasExited) return;
            timer.Stop();
            Log("Parent " + pid + " exited.");
            Application.ExitThread();
        };
        timer.Start();
        return true;
    }

    static int Probe()
    {
        IntPtr hwnd = FindWordCraftWindow();
        if (hwnd == IntPtr.Zero) { Console.WriteLine("WordCraft is not running."); return 2; }
        Console.WriteLine("Window: " + Native.WindowTitle(hwnd));
        Console.WriteLine("Foreground: " + (Native.GetForegroundWindow() == hwnd));
        var tabs = Ribbon.FindTabs(AutomationElement.FromHandle(hwnd));
        if (tabs == null) { Console.WriteLine("No ribbon tab named " + ZoteroTab + "."); return 1; }
        foreach (var tab in tabs)
            Console.WriteLine("Tab: " + tab.Current.Name + (Ribbon.IsOn(tab) ? " (active)" : ""));
        AutomationElement button = Ribbon.FindCitationButton(AutomationElement.FromHandle(hwnd));
        Console.WriteLine(button == null
            ? "Add/Edit Citation is not exposed now (expected unless the Zotero tab is active)."
            : "Add/Edit Citation: " + Ribbon.Patterns(button));
        return 0;
    }

    internal static IntPtr FindWordCraftWindow()
    {
        IntPtr fg = Native.GetForegroundWindow();
        if (IsWordCraft(fg)) return fg;
        foreach (var p in Process.GetProcessesByName(ProcessName))
            if (p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle;
        return IntPtr.Zero;
    }

    internal static bool IsWordCraft(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        uint pid;
        Native.GetWindowThreadProcessId(hwnd, out pid);
        try
        {
            using (var p = Process.GetProcessById((int)pid))
                return string.Equals(p.ProcessName, ProcessName, StringComparison.OrdinalIgnoreCase);
        }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    internal static void Log(string message)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message;
        Console.WriteLine(line);
        if (logPath == null) return;
        try
        {
            var info = new FileInfo(logPath);
            if (info.Exists && info.Length > 256 * 1024) info.Delete();
            File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    internal static bool StayOnZotero { get { return stayOnZotero; } }
}

// Registers the hotkey only while WordCraft is the foreground window, so the key keeps its
// meaning in every other application.
sealed class Hotkey : NativeWindow, IDisposable
{
    const int WM_HOTKEY = 0x0312, Id = 0x4943;
    const uint EVENT_SYSTEM_FOREGROUND = 3;
    const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;

    readonly uint mods, vk;
    readonly string name;
    readonly Native.WinEventProc onForeground;
    readonly IntPtr hook;
    bool registered, announced;
    int busy;

    public Hotkey(uint mods, uint vk, string name)
    {
        this.mods = mods;
        this.vk = vk;
        this.name = name;
        CreateHandle(new CreateParams { Parent = new IntPtr(-3) }); // message-only window
        onForeground = delegate { Update(); };
        hook = Native.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero, onForeground, 0, 0, 0);
        Update();
    }

    void Update()
    {
        bool want = Program.IsWordCraft(Native.GetForegroundWindow());
        if (want == registered) return;
        if (want)
        {
            registered = Native.RegisterHotKey(Handle, Id, mods | MOD_NOREPEAT, vk);
            if (!registered)
                Program.Log("Could not register " + name + " (error " + Marshal.GetLastWin32Error()
                    + "); another program already uses it.");
            else if (!announced)
            {
                Program.Log(name + " is active while WordCraft is in the foreground.");
                announced = true;
            }
        }
        else
        {
            Native.UnregisterHotKey(Handle, Id);
            registered = false;
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == Id)
        {
            IntPtr hwnd = Native.GetForegroundWindow();
            if (Program.IsWordCraft(hwnd) && Interlocked.Exchange(ref busy, 1) == 0)
            {
                // UI Automation calls into WordCraft must not run on the thread that pumps
                // this window's messages.
                var worker = new Thread(delegate ()
                {
                    try { Ribbon.PressCitation(hwnd, Program.StayOnZotero); }
                    catch (Exception e) { Program.Log("Failed: " + e.Message); }
                    finally { Interlocked.Exchange(ref busy, 0); }
                });
                worker.IsBackground = true;
                worker.SetApartmentState(ApartmentState.MTA);
                worker.Start();
            }
            return;
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (registered) Native.UnregisterHotKey(Handle, Id);
        if (hook != IntPtr.Zero) Native.UnhookWinEvent(hook);
        DestroyHandle();
        GC.KeepAlive(onForeground);
    }

    public static bool TryParse(string text, out uint mods, out uint vk)
    {
        mods = 0;
        vk = 0;
        foreach (string raw in text.Split('+'))
        {
            string part = raw.Trim().ToLowerInvariant();
            if (part == "ctrl" || part == "control" || part == "mod" || part == "accel") mods |= MOD_CONTROL;
            else if (part == "shift") mods |= MOD_SHIFT;
            else if (part == "alt" || part == "option") mods |= MOD_ALT;
            else if (part == "win" || part == "meta" || part == "super") mods |= MOD_WIN;
            else if (vk != 0) return false;
            else if (part.Length == 1 && char.IsLetterOrDigit(part[0])) vk = char.ToUpperInvariant(part[0]);
            else
            {
                Match f = Regex.Match(part, "^f([1-9]|1[0-9]|2[0-4])$");
                if (!f.Success) return false;
                vk = (uint)(0x6F + int.Parse(f.Groups[1].Value));
            }
        }
        return vk != 0 && mods != 0;
    }
}

static class Ribbon
{
    static readonly TimeSpan ButtonWait = TimeSpan.FromSeconds(3);

    // Ribbon tabs are buttons with a Toggle pattern; the active tab is toggled on. WordCraft's
    // accessibility tree is flat, so style gallery entries, view buttons and the navigation
    // pane's headings are toggles too: the ribbon tabs are the toggles on Zotero's row.
    public static List<AutomationElement> FindTabs(AutomationElement root)
    {
        var toggles = new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.IsTogglePatternAvailableProperty, true));
        AutomationElementCollection all = root.FindAll(TreeScope.Descendants, toggles);
        AutomationElement zotero = null;
        foreach (AutomationElement e in all)
            if (e.Current.Name == "Zotero") { zotero = e; break; }
        if (zotero == null) return null;
        System.Windows.Rect row = zotero.Current.BoundingRectangle;
        var tabs = new List<AutomationElement>();
        foreach (AutomationElement e in all)
        {
            System.Windows.Rect r = e.Current.BoundingRectangle;
            if (Math.Abs(r.Top - row.Top) <= 4 && Math.Abs(r.Height - row.Height) <= 4) tabs.Add(e);
        }
        return tabs;
    }

    public static bool IsOn(AutomationElement element)
    {
        object pattern;
        return element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)
            && ((TogglePattern)pattern).Current.ToggleState == ToggleState.On;
    }

    public static AutomationElement FindCitationButton(AutomationElement root)
    {
        var buttons = root.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
        foreach (AutomationElement b in buttons)
        {
            string name = Regex.Replace(b.Current.Name ?? "", "\\s+", " ").Trim();
            if (name.StartsWith("Add/Edit", StringComparison.OrdinalIgnoreCase)
                && name.IndexOf("Citation", StringComparison.OrdinalIgnoreCase) >= 0)
                return b;
        }
        return null;
    }

    public static string Patterns(AutomationElement element)
    {
        var names = new List<string>();
        foreach (AutomationPattern p in element.GetSupportedPatterns()) names.Add(p.ProgrammaticName);
        return string.Join(", ", names.ToArray());
    }

    static bool Press(AutomationElement element)
    {
        object pattern;
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
        {
            ((InvokePattern)pattern).Invoke();
            return true;
        }
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
        {
            ((TogglePattern)pattern).Toggle();
            return true;
        }
        return false;
    }

    public static bool PressCitation(IntPtr hwnd, bool stay)
    {
        var watch = Stopwatch.StartNew();
        AutomationElement root = AutomationElement.FromHandle(hwnd);
        List<AutomationElement> tabs = FindTabs(root);
        if (tabs == null) { Program.Log("WordCraft shows no Zotero ribbon tab."); return false; }

        AutomationElement zotero = null, previous = null;
        foreach (var tab in tabs)
        {
            if (tab.Current.Name == "Zotero") zotero = tab;
            else if (IsOn(tab)) previous = tab;
        }
        bool switched = zotero != null && !IsOn(zotero);
        if (switched && !Press(zotero)) { Program.Log("Cannot open the Zotero tab."); return false; }

        AutomationElement button = null;
        while (watch.Elapsed < ButtonWait)
        {
            button = FindCitationButton(root);
            if (button != null) break;
            Thread.Sleep(40);
        }
        if (button == null)
        {
            Program.Log("Add/Edit Citation did not appear within " + ButtonWait.TotalSeconds + " s.");
            if (switched && previous != null) Press(previous);
            return false;
        }
        if (!Press(button))
        {
            Program.Log("Add/Edit Citation cannot be pressed (" + Patterns(button) + ").");
            return false;
        }
        Program.Log("Pressed Add/Edit Citation after " + watch.ElapsedMilliseconds + " ms.");

        if (switched && previous != null && !stay)
        {
            // Let WordCraft act on the click before the button disappears with its tab.
            Thread.Sleep(400);
            Press(previous);
        }
        return true;
    }
}

static class Native
{
    public delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int idObject, int idChild,
        uint thread, uint time);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll")]
    public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc,
        uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);

    public static string WindowTitle(IntPtr hwnd)
    {
        var sb = new StringBuilder(512);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
