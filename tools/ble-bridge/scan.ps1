# Lists Bluetooth LE devices Windows knows about (paired and unpaired), via WinRT.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(15000) | Out-Null; $task.Result }
foreach ($paired in @($true, $false)) {
  $sel = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($paired)
  $list = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  foreach ($d in $list) { "{0}`t{1}`t{2}" -f $(if ($paired) { 'paired' } else { 'unpaired' }), $d.Name, $d.Id }
}
