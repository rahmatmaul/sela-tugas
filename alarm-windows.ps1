param([string]$Payload, [string]$Sound)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReminderWindow {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr handle, int command);
}
'@
$notice = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
$form = New-Object Windows.Forms.Form
$form.Text = 'Sela Tugas'
$form.Size = New-Object Drawing.Size(430, 209)
$form.FormBorderStyle = 'FixedDialog'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.ShowInTaskbar = $true
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object Drawing.Point(($area.Right - $form.Width - 18), ($area.Bottom - $form.Height - 18))
$form.BackColor = [Drawing.ColorTranslator]::FromHtml('#FAF9F4')

$heading = New-Object Windows.Forms.Label
$heading.Text = $notice.heading
$heading.Location = New-Object Drawing.Point(20, 16)
$heading.Size = New-Object Drawing.Size(376, 32)
$heading.Font = New-Object Drawing.Font('Segoe UI', 14, [Drawing.FontStyle]::Bold)
$heading.ForeColor = [Drawing.ColorTranslator]::FromHtml($notice.color)
$form.Controls.Add($heading)

$body = New-Object Windows.Forms.Label
$body.Text = $notice.body
$body.Location = New-Object Drawing.Point(22, 56)
$body.Size = New-Object Drawing.Size(370, 65)
$body.Font = New-Object Drawing.Font('Segoe UI', 11)
$form.Controls.Add($body)

$dismiss = New-Object Windows.Forms.Button
$dismiss.Text = 'Tutup'
$dismiss.Location = New-Object Drawing.Point(314, 129)
$dismiss.Size = New-Object Drawing.Size(82, 29)
$dismiss.Add_Click({ $form.Close() })
$form.Controls.Add($dismiss)
$form.CancelButton = $dismiss

$player = New-Object Media.SoundPlayer($Sound)
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 14000
$timer.Add_Tick({ $form.Close() })
$form.Add_Shown({
  [void][ReminderWindow]::ShowWindow($form.Handle, 5)
  $timer.Start()
  try { $player.Play() } catch { [Console]::Error.WriteLine($_.Exception.Message) }
})
[void]$form.ShowDialog()
$timer.Dispose()
$player.Dispose()
$form.Dispose()
