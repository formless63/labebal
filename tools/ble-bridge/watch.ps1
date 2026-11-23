# Live BLE advertisement scan for a few seconds: address, name, services, RSSI.
param([int]$Seconds = 10)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
$w = New-Object Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher
$w.ScanningMode = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEScanningMode]::Active
$seen = @{}
$null = Register-ObjectEvent -InputObject $w -EventName Received -SourceIdentifier adv
$w.Start()
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  $e = Wait-Event -SourceIdentifier adv -Timeout 1
  if (-not $e) { continue }
  $a = $e.SourceEventArgs; Remove-Event -EventIdentifier $e.EventIdentifier
  $addr = '{0:X12}' -f $a.BluetoothAddress
  $name = $a.Advertisement.LocalName
  $svc = ($a.Advertisement.ServiceUuids | ForEach-Object { $_.ToString() }) -join ','
  $key = "$addr|$name"
  if (-not $seen.ContainsKey($key)) { $seen[$key] = 1; "{0}`t{1}`trssi={2}`t{3}" -f $addr, $name, $a.RawSignalStrengthInDBm, $svc }
}
$w.Stop()
Unregister-Event -SourceIdentifier adv
