# File: apps/desktop/tests/visual/window-affinity.ps1
# Purpose: Lists the visible top-level windows of the given processes with their screen-capture
#          setting (GetWindowDisplayAffinity: 0x11 = WDA_EXCLUDEFROMCAPTURE, left out of every
#          capture API: Windows Graphics Capture, DXGI duplication and GDI; 0 = captured). It can first
#          rest the real mouse pointer on a point (to open a native tooltip), then puts it back.
#          Prints one JSON array: class name, process id, size and affinity per window. No window titles.
# Used by: apps/desktop/tests/visual/compact-view-check.ts (ADR-0085 Private checks)
# Usage: powershell -File window-affinity.ps1 -Pids 1234,5678 [-X 100 -Y 200 -WaitMs 1500]
param([string]$Pids, [int]$X = -1, [int]$Y = -1, [int]$WaitMs = 0)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class KiteWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  public static List<string> List(uint[] pids) {
    var rows = new List<string>();
    var wanted = new HashSet<uint>(pids);
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!wanted.Contains(pid) || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, 256);
      uint a; GetWindowDisplayAffinity(h, out a);
      RECT r; GetWindowRect(h, out r);
      rows.Add("{\"cls\":\"" + cls.ToString().Replace("\"", "") + "\",\"pid\":" + pid + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"affinity\":" + a + "}");
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@
[KiteWin]::SetProcessDPIAware() | Out-Null
$ids = $Pids.Split(',') | ForEach-Object { [uint32]$_ }
$p = New-Object KiteWin+POINT
[KiteWin]::GetCursorPos([ref]$p) | Out-Null
if ($X -ge 0) {
  # A small move onto the point, then rest there: a tooltip opens after the pointer stops.
  [KiteWin]::SetCursorPos($X - 4, $Y) | Out-Null; Start-Sleep -Milliseconds 80
  [KiteWin]::SetCursorPos($X, $Y) | Out-Null; Start-Sleep -Milliseconds $WaitMs
}
$rows = [KiteWin]::List($ids)
if ($X -ge 0) { [KiteWin]::SetCursorPos($p.X, $p.Y) | Out-Null }
'[' + ($rows -join ',') + ']'
