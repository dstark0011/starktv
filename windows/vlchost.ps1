# StarkTV video host: a borderless native window that VLC draws into, kept over the player area by StarkTV.
# stdin commands:  bounds x y w h  |  show  |  hide  |  exit        stdout:  HWND <handle>  |  click  |  dblclick
param([Int64]$Owner = 0)
$ErrorActionPreference = 'Stop'
Add-Type -Name Dpi -Namespace StarkTV -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][StarkTV.Dpi]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'
$f.ShowInTaskbar = $false
$f.BackColor = [System.Drawing.Color]::Black
$f.StartPosition = 'Manual'
$f.Text = 'StarkTV video'
$f.SetBounds(-32000, -32000, 320, 180)

$panel = New-Object System.Windows.Forms.Panel
$panel.Dock = 'Fill'
$panel.BackColor = [System.Drawing.Color]::Black
$f.Controls.Add($panel)

$owner = New-Object System.Windows.Forms.NativeWindow
if ($Owner -ne 0) { $owner.AssignHandle([IntPtr]$Owner) }
$f.Show($owner)

$out = [Console]::Out
$out.WriteLine('HWND ' + $panel.Handle.ToInt64()); $out.Flush()
$f.Add_Activated({ $out.WriteLine('activated'); $out.Flush() })
$panel.Add_DoubleClick({ $out.WriteLine('dblclick'); $out.Flush() })

$script:shown = $false
$script:rect = @(-32000, -32000, 320, 180)
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$script:task = $reader.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 25
$timer.Add_Tick({
  while ($script:task.IsCompleted) {
    $line = $script:task.Result
    if ($null -eq $line) { $f.Close(); return }
    $p = $line.Trim().Split(' ')
    switch ($p[0]) {
      'bounds' { $script:rect = @([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4]); if ($script:shown) { $f.SetBounds($script:rect[0], $script:rect[1], $script:rect[2], $script:rect[3]) } }
      'show'   { $script:shown = $true;  $f.SetBounds($script:rect[0], $script:rect[1], $script:rect[2], $script:rect[3]) }
      'hide'   { $script:shown = $false; $f.SetBounds(-32000, -32000, $script:rect[2], $script:rect[3]) }
      'exit'   { $f.Close(); return }
    }
    $script:task = $reader.ReadLineAsync()
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run($f)
