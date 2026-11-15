param(
    [Parameter(Mandatory = $true)][string]$ExecutablePath,
    [Parameter(Mandatory = $true)][int]$ClientWidth,
    [Parameter(Mandatory = $true)][int]$ClientHeight,
    [Parameter(Mandatory = $true)][int]$TitlebarHeight,
    [Parameter(Mandatory = $true)][int]$CaptionButtonWidth,
    [string]$CapturePath,
    [string]$ThemePath,
    [switch]$DarkTheme
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EuiChromeProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint key, uint kind);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr window, string name);
    public static int HitTest(IntPtr window, int x, int y) {
        Rect bounds;
        if (!GetWindowRect(window, out bounds)) throw new Exception("Cannot read window bounds");
        return SendMessage(window, 0x84, IntPtr.Zero, new IntPtr(((bounds.Top + y) << 16) | ((bounds.Left + x) & 0xffff))).ToInt32();
    }
    public static void Press(IntPtr window, uint key) {
        var scan = MapVirtualKey(key, 0) << 16;
        if (!PostMessage(window, 0x100, new IntPtr(key), new IntPtr(scan | 1)) ||
            !PostMessage(window, 0x101, new IntPtr(key), new IntPtr(unchecked((int)(scan | 0xc0000001)))))
            throw new Exception("Cannot deliver a key to the test window");
    }
}
'@
function Wait-Condition([scriptblock]$Condition, [string]$Failure) {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) { return }
        if ($process.HasExited) { throw "EUI test process exited early: $($process.ExitCode)" }
        Start-Sleep -Milliseconds 50
    }
    throw $Failure
}
$process = Start-Process -FilePath $ExecutablePath -WorkingDirectory ([System.IO.Path]::GetTempPath()) -PassThru
try {
    $script:window = [IntPtr]::Zero
    Wait-Condition {
        $process.Refresh()
        $script:window = $process.MainWindowHandle
        $script:window -ne [IntPtr]::Zero -and [EuiChromeProbe]::GetProp($script:window, 'ycIDE.EUI.form') -ne [IntPtr]::Zero
    } 'EUI window chrome did not initialize'
    Start-Sleep -Milliseconds 500
    $scale = [EuiChromeProbe]::GetDpiForWindow($window) / 96.0
    $outer = New-Object EuiChromeProbe+Rect
    $client = New-Object EuiChromeProbe+Rect
    if (-not [EuiChromeProbe]::GetWindowRect($window, [ref]$outer) -or -not [EuiChromeProbe]::GetClientRect($window, [ref]$client)) { throw 'Cannot inspect EUI window dimensions' }
    if (([EuiChromeProbe]::GetWindowLong($window, -16) -band 0x00c00000) -ne 0) { throw 'EUI still has a native Windows caption/border' }
    if ($outer.Right - $outer.Left -ne $client.Right -or $outer.Bottom - $outer.Top -ne $client.Bottom) { throw 'EUI still has a native non-client frame' }
    if ([Math]::Abs($client.Right / $scale - $ClientWidth) -gt 1 -or [Math]::Abs($client.Bottom / $scale - $ClientHeight - $TitlebarHeight) -gt 1) { throw "Client/chrome sizing mismatch: $($client.Right)x$($client.Bottom), scale $scale" }
    if ([EuiChromeProbe]::HitTest($window, [int](100 * $scale), [int]($TitlebarHeight * $scale / 2)) -ne 2) { throw 'Self-drawn titlebar is not draggable' }
    if ([EuiChromeProbe]::HitTest($window, $client.Right - [int]($CaptionButtonWidth * $scale / 2), [int]($TitlebarHeight * $scale / 2)) -ne 1) { throw 'Caption button is intercepted by native hit testing' }
    if ([EuiChromeProbe]::HitTest($window, 1, 1) -ne 13) { throw 'Window corner is not resizable' }
    if ($CapturePath -or $ThemePath) {
        Add-Type -AssemblyName System.Drawing
        $bitmap = New-Object System.Drawing.Bitmap($client.Right, $client.Bottom)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $dc = $graphics.GetHdc()
            try {
                if (-not [EuiChromeProbe]::PrintWindow($window, $dc, 3)) { throw 'Cannot capture the owned test window' }
            } finally { $graphics.ReleaseHdc($dc) }
            if ($CapturePath) { $bitmap.Save($CapturePath, [System.Drawing.Imaging.ImageFormat]::Png) }
            if ($ThemePath) {
                $theme = Get-Content -LiteralPath $ThemePath -Raw | ConvertFrom-Json
                $palette = if ($DarkTheme) { $theme.dark } else { $theme.light }
                foreach ($sample in @(
                    @{ X = 20; Y = 5; Expected = $palette.surface; Name = 'titlebar' },
                    @{ X = 10; Y = $TitlebarHeight + 10; Expected = $palette.background; Name = 'client' }
                )) {
                    $pixel = $bitmap.GetPixel([int]($sample.X * $scale), [int]($sample.Y * $scale))
                    $channels = @($pixel.R, $pixel.G, $pixel.B)
                    for ($index = 0; $index -lt 3; $index++) {
                        if ([Math]::Abs($channels[$index] - $sample.Expected[$index] * 255) -gt 3) { throw "Rendered $($sample.Name) does not match shared theme: $pixel" }
                    }
                }
                [void][EuiChromeProbe]::SendMessage($window, 0xa3, [IntPtr]2, [IntPtr]::Zero)
                Wait-Condition { [EuiChromeProbe]::IsZoomed($window) } 'Double-clicking the self-drawn titlebar did not maximize'
                [void][EuiChromeProbe]::SendMessage($window, 0xa3, [IntPtr]2, [IntPtr]::Zero)
                Wait-Condition { -not [EuiChromeProbe]::IsZoomed($window) } 'Double-clicking the self-drawn titlebar did not restore'
                Start-Sleep -Milliseconds 250
            }
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
    [EuiChromeProbe]::Press($window, 9)
    Start-Sleep -Milliseconds 150
    [EuiChromeProbe]::Press($window, 32)
    Wait-Condition { [EuiChromeProbe]::IsIconic($window) } 'Keyboard activation of self-drawn minimize button failed'
    [void][EuiChromeProbe]::ShowWindow($window, 9)
    Start-Sleep -Milliseconds 250
    [EuiChromeProbe]::Press($window, 9)
    Start-Sleep -Milliseconds 150
    [EuiChromeProbe]::Press($window, 32)
    Wait-Condition { [EuiChromeProbe]::IsZoomed($window) } 'Keyboard activation of self-drawn maximize button failed'
    Start-Sleep -Milliseconds 250
    [EuiChromeProbe]::Press($window, 32)
    Wait-Condition { -not [EuiChromeProbe]::IsZoomed($window) } 'Self-drawn restore button failed'
    Start-Sleep -Milliseconds 250
    [EuiChromeProbe]::Press($window, 9)
    Start-Sleep -Milliseconds 150
    [EuiChromeProbe]::Press($window, 32)
    if (-not $process.WaitForExit(10000)) { throw 'Keyboard activation of self-drawn close button failed' }
    if ($process.ExitCode -ne 0) { throw "EUI window exited with $($process.ExitCode)" }
    Write-Output 'Self-drawn window: no native caption/frame; logical client geometry, drag/resize hit testing and keyboard minimize/maximize/restore/close passed.'
} finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    $process.Dispose()
}
