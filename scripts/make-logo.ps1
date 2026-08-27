Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$size = 256
$outDir = Join-Path $PSScriptRoot '..\assets'
$renderer = Join-Path $PSScriptRoot '..\src\renderer'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$clip = New-Object System.Drawing.Drawing2D.GraphicsPath
$clip.AddEllipse(1, 1, $size - 3, $size - 3)
$g.SetClip($clip)

$top = [System.Drawing.Color]::FromArgb(255, 230, 126, 34)
$mid = [System.Drawing.Color]::FromArgb(255, 255, 186, 110)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0, 0),
  (New-Object System.Drawing.Point 0, [int]($size * 0.72)),
  $top, $mid
)
$g.FillRectangle($grad, 0, 0, $size, $size)

$islandY = [int]($size * 0.58)
$black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 10, 10, 10))
$island = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 22
$rect = New-Object System.Drawing.Rectangle 0, $islandY, $size, ($size - $islandY + 8)
$d = $radius * 2
$island.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$island.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$island.AddLine($rect.Right, $rect.Bottom, $rect.X, $rect.Bottom)
$island.CloseFigure()
$g.FillPath($black, $island)

$glow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 255, 210, 150), 3)
$g.DrawLine($glow, 14, $islandY + 11, $size - 14, $islandY + 11)

$dest = Join-Path $outDir 'logo.png'
$bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
Copy-Item -Force $dest (Join-Path $renderer 'logo.png')
$g.Dispose()
$bmp.Dispose()
$grad.Dispose()
$clip.Dispose()
$island.Dispose()
$black.Dispose()
$glow.Dispose()
Write-Output $dest
