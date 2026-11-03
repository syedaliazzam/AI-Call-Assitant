# File: apps/desktop/tests/visual/capture.ps1
# Purpose: Saves a real screen capture (what the user sees, with every window composited, so a
#          see-through overlay shows what is behind it) of one rectangle, in physical pixels.
# Used by: apps/desktop/tests/visual/call-window-shots.ts (v1.0.3 visual checks)
# Usage: powershell -File capture.ps1 -X 0 -Y 0 -W 800 -H 600 -Out shot.png
param([int]$X, [int]$Y, [int]$W, [int]$H, [string]$Out)
Add-Type -AssemblyName System.Drawing
# Per-monitor DPI awareness, so the coordinates are physical pixels, not scaled ones.
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[Dpi]::SetProcessDPIAware() | Out-Null
$bitmap = New-Object System.Drawing.Bitmap $W, $H
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($X, $Y, 0, 0, $bitmap.Size)
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
