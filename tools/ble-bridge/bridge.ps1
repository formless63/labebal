<#
  labebal BLE bridge (Windows PowerShell 5.1, nothing to install, no compiled binaries on disk).

  Talks Bluetooth LE through the Windows WinRT APIs and relays raw packets as
  hex lines, so Node (niimbluelib) can drive a Niimbot printer from the desktop:

    stdout:  DEV <addr> <name> <rssi> <services>   (scan mode)
             READY <address> <name> <char uuid>    connected
             RX <hex>                              notification from the printer
             LOG <text> / ERR <text>
    stdin:   TX <hex>                              write without response
             QUIT

  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File bridge.ps1 -Scan [-Seconds 10]
          powershell -NoProfile -ExecutionPolicy Bypass -File bridge.ps1 -Name N1 | -Address AABBCCDDEEFF

  LabebalBle.cs is compiled in memory (CodeDom), because WinRT events can't be
  subscribed from PowerShell 5.1 directly.
#>
param([switch]$Scan, [string]$Name = "", [string]$Address = "", [int]$Seconds = 10, [string]$Com = "")
$ErrorActionPreference = "Stop"

$provider = New-Object Microsoft.CSharp.CSharpCodeProvider
$cp = New-Object System.CodeDom.Compiler.CompilerParameters
$cp.GenerateInMemory = $true
foreach ($r in @("System.dll", "System.Core.dll")) { [void]$cp.ReferencedAssemblies.Add($r) }
$res = $provider.CompileAssemblyFromSource($cp, [IO.File]::ReadAllText((Join-Path $PSScriptRoot "LabebalBle.cs")))
if ($res.Errors.HasErrors) { foreach ($e in $res.Errors) { [Console]::Out.WriteLine("ERR compile " + $e.ToString()) }; exit 3 }
$null = $res.CompiledAssembly

function Emit([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }

# Classic Bluetooth (SPP) or USB serial: the printer's COM port. Same line protocol.
if ($Com) {
  $port = New-Object System.IO.Ports.SerialPort $Com, 115200
  $port.ReadTimeout = 50
  try {
    $port.Open()
    Emit "READY $Com serial"
    [StdinPump]::Start()
    $buf = New-Object byte[] 4096
    $line = $null
    $quit = $false
    while (-not $quit) {
      while ($port.BytesToRead -gt 0) {
        $n = $port.Read($buf, 0, [Math]::Min($buf.Length, $port.BytesToRead))
        if ($n -gt 0) { Emit ("RX " + ([BitConverter]::ToString($buf, 0, $n) -replace "-", "").ToLowerInvariant()) }
      }
      while ([StdinPump]::Lines.TryDequeue([ref]$line)) {
        if ($line -eq "QUIT") { $quit = $true; break }
        if ($line.StartsWith("TX ")) {
          $hex = $line.Substring(3).Trim()
          $bytes = New-Object byte[] ($hex.Length / 2)
          for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
          $port.Write($bytes, 0, $bytes.Length)
        }
      }
      if ([StdinPump]::Closed -and [StdinPump]::Lines.IsEmpty) { break }
      Start-Sleep -Milliseconds 5
    }
  } catch {
    Emit ("ERR " + $_.Exception.GetBaseException().Message)
    exit 1
  } finally {
    if ($port.IsOpen) { $port.Close() }
  }
  exit 0
}

if ($Scan) {
  foreach ($l in [LabebalBle]::Scan($Seconds, $Name)) { Emit "DEV $l" }
  $out = $null
  while ([LabebalBle]::Out.TryDequeue([ref]$out)) { Emit $out }
  exit 0
}

try {
  if (-not $Address) {
    Emit "LOG scanning for '$Name' ($Seconds s)"
    $hit = [LabebalBle]::Scan($Seconds, $Name) | Where-Object { $n = ($_ -split "`t")[1]; $n -and $n -like "*$Name*" } | Select-Object -First 1
    if (-not $hit) { Emit "ERR no device named '$Name' found"; exit 2 }
    $Address = ($hit -split "`t")[0]
  }
  $info = [LabebalBle]::Connect($Address)
  $out = $null
  while ([LabebalBle]::Out.TryDequeue([ref]$out)) { Emit $out }
  Emit "READY $Address $info"

  [StdinPump]::Start()
  $line = $null
  $quit = $false
  while (-not $quit) {
    while ([LabebalBle]::Out.TryDequeue([ref]$out)) { Emit $out }
    while ([StdinPump]::Lines.TryDequeue([ref]$line)) {
      if ($line -eq "QUIT") { $quit = $true; break }
      if ($line.StartsWith("TX ")) {
        $st = [LabebalBle]::Write($line.Substring(3).Trim())
        if ($st -ne "Success") { Emit "ERR write $st" }
      }
    }
    if ([StdinPump]::Closed -and [StdinPump]::Lines.IsEmpty) { break }
    Start-Sleep -Milliseconds 5
  }
} catch {
  Emit ("ERR " + $_.Exception.GetBaseException().Message)
  exit 1
} finally {
  [LabebalBle]::Close()
}
