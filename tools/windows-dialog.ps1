# Answers the native Windows dialogs and Chrome's own permission prompts of the lab window, the way a person would: the real dialog
# opens, a path goes into its field, its real button is pressed. Nothing but the lab's Chrome is touched, and only lab paths are accepted.
#
#   powershell -File tools/windows-dialog.ps1 show                  what dialogs are open and what is in them
#   powershell -File tools/windows-dialog.ps1 choose <path>         answers a folder, open or save dialog with this path
#   powershell -File tools/windows-dialog.ps1 cancel                presses Cancel
#   powershell -File tools/windows-dialog.ps1 prompt [<button>]     Chrome's own prompt in the window: lists it, or presses this button
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Value = "",
  [int]$WaitSeconds = 10
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$Lab = if ($env:ANNATERIA_LAB) { $env:ANNATERIA_LAB } else { "D:\ANNATERIA-LAB" }
$Tree = [System.Windows.Automation.TreeScope]
$Element = [System.Windows.Automation.AutomationElement]
$True_ = [System.Windows.Automation.Condition]::TrueCondition

function Get-LabWindows {
  $profile = Join-Path $Lab "browser-profile"
  $ids = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |
    ForEach-Object { [int]$_.ProcessId }
  $Element::RootElement.FindAll($Tree::Children, $True_) | Where-Object {
    $_.Current.ClassName -eq "Chrome_WidgetWin_1" -and $ids -contains $_.Current.ProcessId
  }
}

function Find-Dialog {
  $byClass = New-Object System.Windows.Automation.PropertyCondition($Element::ClassNameProperty, "#32770")
  foreach ($window in @(Get-LabWindows)) {
    $found = $window.FindFirst($Tree::Children, $byClass)
    if ($found) { return $found }
  }
  return $null
}

function Wait-Dialog {
  $until = (Get-Date).AddSeconds($WaitSeconds)
  do {
    $dialog = Find-Dialog
    if ($dialog) { return $dialog }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $until)
  throw "No Windows dialog of the lab's Chrome opened in $WaitSeconds seconds."
}

function Get-Controls($root, [string]$type) {
  $control = [System.Windows.Automation.ControlType]::$type
  $condition = New-Object System.Windows.Automation.PropertyCondition($Element::ControlTypeProperty, $control)
  return $root.FindAll($Tree::Descendants, $condition)
}

# The fields and buttons of a common dialog are plain Win32 controls, and UI Automation shows them as panes with no patterns, so they
# get the messages a person's typing and clicking would give them. This needs no focus, so nothing goes astray to another window.
Add-Type -Namespace Lab -Name Win32 -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hwnd, System.IntPtr param);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumChildWindows(System.IntPtr parent, EnumProc proc, System.IntPtr param);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetClassName(System.IntPtr hwnd, System.Text.StringBuilder name, int size);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetDlgCtrlID(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessage(System.IntPtr hwnd, int message, System.IntPtr wide, string text);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hwnd, int message, System.IntPtr wide, System.IntPtr low);
'@
$WM_SETTEXT = 0x000C
$BM_CLICK = 0x00F5

function Get-Children($dialog) {
  $found = New-Object System.Collections.ArrayList
  $proc = [Lab.Win32+EnumProc] {
    param($hwnd, $param)
    $name = New-Object System.Text.StringBuilder 64
    [void][Lab.Win32]::GetClassName($hwnd, $name, 64)
    [void]$found.Add([pscustomobject]@{ Hwnd = $hwnd; Class = $name.ToString(); Id = [Lab.Win32]::GetDlgCtrlID($hwnd); Visible = [Lab.Win32]::IsWindowVisible($hwnd) })
    return $true
  }
  [void][Lab.Win32]::EnumChildWindows([IntPtr]$dialog.Current.NativeWindowHandle, $proc, [IntPtr]::Zero)
  return $found
}

function Show-Tree($dialog) {
  "dialog: $($dialog.Current.Name)"
  Get-Children $dialog | Where-Object { $_.Visible -and $_.Class -in "Edit", "Button" } | ForEach-Object { "  $($_.Class) id=$($_.Id)" }
}

# The folder picker's field is 1152. In the open and save dialogs it is an Edit inside the combo box 1148.
function Get-PathField($dialog) {
  $edits = @(Get-Children $dialog | Where-Object { $_.Class -eq "Edit" -and $_.Visible })
  $field = $edits | Where-Object { $_.Id -in 1152, 1148, 1001 } | Select-Object -First 1
  if (-not $field) { $field = $edits | Select-Object -First 1 }
  if (-not $field) { throw "This dialog has no path field." }
  return $field.Hwnd
}

# Button 1 is the default button of a common dialog: Select Folder, Open or Save, in any language.
function Press-Confirm($dialog) {
  $button = Get-Children $dialog | Where-Object { $_.Class -eq "Button" -and $_.Id -eq 1 } | Select-Object -First 1
  if (-not $button) { throw "This dialog has no confirm button." }
  [void][Lab.Win32]::PostMessage($button.Hwnd, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
}

function Get-Controls($root, [string]$type) {
  $control = [System.Windows.Automation.ControlType]::$type
  $condition = New-Object System.Windows.Automation.PropertyCondition($Element::ControlTypeProperty, $control)
  return $root.FindAll($Tree::Descendants, $condition)
}

function Press($button) {
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

switch ($Action) {
  "show" {
    $dialog = Find-Dialog
    if ($dialog) { Show-Tree $dialog } else { "no dialog" }
  }
  "choose" {
    $full = [System.IO.Path]::GetFullPath($Value)
    if (-not $full.StartsWith($Lab, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Only paths inside $Lab are allowed in the lab: $full" }
    $dialog = Wait-Dialog
    [void][Lab.Win32]::SendMessage((Get-PathField $dialog), $WM_SETTEXT, [IntPtr]::Zero, $full)
    Press-Confirm $dialog
    # A folder picker may first walk into the folder and need the button once more.
    Start-Sleep -Milliseconds 1000
    $still = Find-Dialog
    if ($still) {
      Press-Confirm $still
      Start-Sleep -Milliseconds 700
    }
    "chosen: $full; dialog open now: $([bool](Find-Dialog))"
  }
  "cancel" {
    $dialog = Wait-Dialog
    $cancel = Get-Children $dialog | Where-Object { $_.Class -eq "Button" -and $_.Id -eq 2 } | Select-Object -First 1
    [void][Lab.Win32]::PostMessage($cancel.Hwnd, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
    "cancelled"
  }
  "prompt" {
    # Chrome's permission prompts are part of its own window, not of the page.
    foreach ($window in @(Get-LabWindows)) {
      foreach ($button in (Get-Controls $window "Button")) {
        $name = $button.Current.Name
        if ($Value -and $name -eq $Value) { Press $button; "pressed: $name"; return }
        if (-not $Value) { "button: $name" }
      }
    }
    if ($Value) { throw "No button '$Value' in the lab's Chrome window." }
  }
  default { throw "Unknown action: $Action" }
}
