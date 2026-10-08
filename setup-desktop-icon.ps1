# One-time setup: generates a Ledgerly .ico and creates a Desktop shortcut
# that runs launch-ledgerly.ps1.

$ProjectDir  = 'Z:\Claude Accounting'
$LauncherPs1 = Join-Path $ProjectDir 'launch-ledgerly.ps1'
$IconPath    = Join-Path $ProjectDir 'ledgerly.ico'

# --- 1. Draw a simple icon (teal rounded square with an "L") ---------------
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$radius = 48
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($size - $d, 0, $d, $d, 270, 90)
$path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$path.AddArc(0, $size - $d, $d, $d, 90, 90)
$path.CloseFigure()

$bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 13, 148, 136))  # brand-600 teal
$g.FillPath($bg, $path)

$font = New-Object System.Drawing.Font('Segoe UI', 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fg   = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$sf   = New-Object System.Drawing.StringFormat
$sf.Alignment     = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF(0, -10, $size, $size)
$g.DrawString('L', $font, $fg, $rect, $sf)
$g.Dispose()

$hicon = $bmp.GetHicon()
$icon  = [System.Drawing.Icon]::FromHandle($hicon)
$fs    = [System.IO.File]::Create($IconPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
Write-Host "Icon written to $IconPath"

# --- 2. Create the Desktop shortcut ----------------------------------------
$desktop  = [Environment]::GetFolderPath('Desktop')
$lnkPath  = Join-Path $desktop 'Ledgerly.lnk'

$wsh = New-Object -ComObject WScript.Shell
$sc  = $wsh.CreateShortcut($lnkPath)
$sc.TargetPath       = 'powershell.exe'
$sc.Arguments        = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$LauncherPs1`""
$sc.WorkingDirectory = $ProjectDir
$sc.IconLocation     = "$IconPath,0"
$sc.Description       = 'Launch Ledgerly (local accounting app)'
$sc.WindowStyle      = 7
$sc.Save()
Write-Host "Shortcut created at $lnkPath"
