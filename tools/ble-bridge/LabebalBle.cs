using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

/// Reads stdin lines on a background thread. Console.In.ReadLineAsync is
/// synchronous on .NET Framework, which would block the bridge loop (and
/// delay printer responses) until the next command line arrived.
public static class StdinPump {
  public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
  public static volatile bool Closed;
  public static void Start() {
    var t = new Thread(() => {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) Lines.Enqueue(line);
      } catch { }
      Closed = true;
    });
    t.IsBackground = true;
    t.Start();
  }
}

// Bluetooth LE helper for bridge.ps1, compiled in memory by CodeDom (.NET Framework C# 5).
// WinRT is reached through reflection: that compiler can't bind WinRT types/events
// statically, but the runtime projection works fine.
public static class LabebalBle {
  public static readonly ConcurrentQueue<string> Out = new ConcurrentQueue<string>();
  static object dev, chr;

  static Type T(string name) {
    string ns = name.Substring(0, name.LastIndexOf('.'));
    return Type.GetType(name + ", " + ns + ", ContentType=WindowsRuntime", true);
  }
  static readonly Type Ext = Type.GetType("System.WindowsRuntimeSystemExtensions, System.Runtime.WindowsRuntime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089", true);
  static readonly MethodInfo AsTaskOp = Ext.GetMethods().First(m => m.Name == "AsTask" && m.IsGenericMethod && m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType.Name == "IAsyncOperation`1");

  static object Await(object op, Type result) {
    var task = (Task)AsTaskOp.MakeGenericMethod(result).Invoke(null, new[] { op });
    if (!task.Wait(20000)) throw new TimeoutException("WinRT call timed out");
    return task.GetType().GetProperty("Result").GetValue(task, null);
  }
  static object Get(object o, Type t, string prop) { return t.GetProperty(prop).GetValue(o, null); }
  static object Call(object o, Type t, string name, params object[] args) {
    var m = t.GetMethods().First(x => x.Name == name && x.GetParameters().Length == args.Length);
    return m.Invoke(o, args);
  }
  static object En(string type, int v) { return Enum.ToObject(T(type), v); }
  // WinRT events must be wired through WindowsRuntimeMarshal with delegates to the
  // add_/remove_ accessors (reflection's EventInfo.AddEventHandler is not supported).
  static void On(object o, Type t, string evt, string handler) {
    var ev = t.GetEvent(evt);
    var hType = ev.EventHandlerType;
    var mi = typeof(LabebalBle).GetMethod(handler, BindingFlags.NonPublic | BindingFlags.Static);
    var h = Delegate.CreateDelegate(hType, mi);
    var tokenT = typeof(System.Runtime.InteropServices.WindowsRuntime.EventRegistrationToken);
    var add = Delegate.CreateDelegate(typeof(Func<,>).MakeGenericType(hType, tokenT), o, ev.GetAddMethod());
    var remove = Delegate.CreateDelegate(typeof(Action<>).MakeGenericType(tokenT), o, ev.GetRemoveMethod());
    typeof(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal)
      .GetMethod("AddEventHandler").MakeGenericMethod(hType)
      .Invoke(null, new object[] { add, remove, h });
  }
  static byte[] Bytes(object buffer) {
    var cb = T("Windows.Security.Cryptography.CryptographicBuffer");
    var args = new object[] { buffer, null };
    cb.GetMethod("CopyToByteArray").Invoke(null, args);
    return (byte[])args[1] ?? new byte[0];
  }
  static object Buffer(byte[] b) { return T("Windows.Security.Cryptography.CryptographicBuffer").GetMethod("CreateFromByteArray").Invoke(null, new object[] { b }); }
  static string Hex(byte[] b) { return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant(); }
  static byte[] FromHex(string h) { var r = new byte[h.Length / 2]; for (int i = 0; i < r.Length; i++) r[i] = Convert.ToByte(h.Substring(i * 2, 2), 16); return r; }

  /* ---------------------------------------------------------------- scan */
  static readonly ConcurrentDictionary<ulong, string> seen = new ConcurrentDictionary<ulong, string>();

  static void OnAdv(object watcher, object a) {
    try {
      var at = T("Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementReceivedEventArgs");
      var advT = T("Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisement");
      var adv = Get(a, at, "Advertisement");
      string name = (string)Get(adv, advT, "LocalName") ?? "";
      var uuids = ((IEnumerable)Get(adv, advT, "ServiceUuids")).Cast<object>().Select(u => u.ToString()).ToList();
      ulong addr = (ulong)Get(a, at, "BluetoothAddress");
      short rssi = (short)Get(a, at, "RawSignalStrengthInDBm");
      string fresh = string.Format("{0:X12}\t{1}\t{2}\t{3}", addr, name, rssi, string.Join(",", uuids));
      seen.AddOrUpdate(addr, fresh, (k, old) => {
        var p = old.Split('\t');
        return string.Format("{0:X12}\t{1}\t{2}\t{3}", addr, name.Length > 0 ? name : p[1], rssi, uuids.Count > 0 ? string.Join(",", uuids) : p[3]);
      });
    } catch (Exception e) { Out.Enqueue("LOG adv error " + e.GetBaseException().Message); }
  }

  public static List<string> Scan(int seconds, string nameFilter) {
    var wt = T("Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher");
    var w = Activator.CreateInstance(wt);
    wt.GetProperty("ScanningMode").SetValue(w, En("Windows.Devices.Bluetooth.Advertisement.BluetoothLEScanningMode", 1), null);
    On(w, wt, "Received", "OnAdv");
    Call(w, wt, "Start");
    var end = DateTime.Now.AddSeconds(seconds);
    while (DateTime.Now < end) {
      Thread.Sleep(200);
      if (!string.IsNullOrEmpty(nameFilter) && seen.Values.Any(v => v.Split('\t')[1].IndexOf(nameFilter, StringComparison.OrdinalIgnoreCase) >= 0)) break;
    }
    Call(w, wt, "Stop");
    return seen.Values.ToList();
  }

  /* ------------------------------------------------------------- connect */
  const string G = "Windows.Devices.Bluetooth.GenericAttributeProfile.";

  static void OnValue(object c, object a) {
    try { Out.Enqueue("RX " + Hex(Bytes(Get(a, T(G + "GattValueChangedEventArgs"), "CharacteristicValue")))); }
    catch (Exception e) { Out.Enqueue("LOG rx error " + e.GetBaseException().Message); }
  }

  static void OnStatus(object d, object a) {
    try { Out.Enqueue("LOG connection " + Get(d, T("Windows.Devices.Bluetooth.BluetoothLEDevice"), "ConnectionStatus")); } catch { }
  }

  public static string Connect(string addressHex) {
    var devT = T("Windows.Devices.Bluetooth.BluetoothLEDevice");
    var uncached = En("Windows.Devices.Bluetooth.BluetoothCacheMode", 1);
    dev = Await(devT.GetMethod("FromBluetoothAddressAsync", new[] { typeof(ulong) }).Invoke(null, new object[] { Convert.ToUInt64(addressHex, 16) }), devT);
    if (dev == null) throw new Exception("device not found: " + addressHex);
    var srT = T(G + "GattDeviceServicesResult");
    var sr = Await(Call(dev, devT, "GetGattServicesAsync", uncached), srT);
    var status = Get(sr, srT, "Status").ToString();
    if (status != "Success") throw new Exception("GATT services: " + status);
    var svcT = T(G + "GattDeviceService");
    var crT = T(G + "GattCharacteristicsResult");
    var chrT = T(G + "GattCharacteristic");
    foreach (var s in (IEnumerable)Get(sr, srT, "Services")) {
      var suuid = Get(s, svcT, "Uuid").ToString();
      var cr = Await(Call(s, svcT, "GetCharacteristicsAsync", uncached), crT);
      if (Get(cr, crT, "Status").ToString() != "Success") continue;
      foreach (var c in (IEnumerable)Get(cr, crT, "Characteristics")) {
        int props = Convert.ToInt32(Get(c, chrT, "CharacteristicProperties"));
        Out.Enqueue("LOG char " + suuid + " / " + Get(c, chrT, "Uuid") + " props=0x" + props.ToString("x"));
        // Notify (0x10) + WriteWithoutResponse (0x04) on a custom 128-bit service, like niimbluelib.
        if (chr == null && (props & 0x10) != 0 && (props & 0x04) != 0 && !suuid.StartsWith("0000")) chr = c;
      }
    }
    if (chr == null) throw new Exception("no notify+write characteristic");
    On(chr, chrT, "ValueChanged", "OnValue");
    var st = Await(Call(chr, chrT, "WriteClientCharacteristicConfigurationDescriptorAsync", En(G + "GattClientCharacteristicConfigurationDescriptorValue", 1)), T(G + "GattCommunicationStatus"));
    if (st.ToString() != "Success") throw new Exception("subscribe: " + st);
    On(dev, devT, "ConnectionStatusChanged", "OnStatus");
    return (Get(dev, devT, "Name") ?? "") + "\t" + Get(chr, chrT, "Uuid");
  }

  public static string Write(string hex) {
    var chrT = T(G + "GattCharacteristic");
    var op = chrT.GetMethods().First(m => m.Name == "WriteValueAsync" && m.GetParameters().Length == 2)
      .Invoke(chr, new[] { Buffer(FromHex(hex)), En(G + "GattWriteOption", 1) });
    return Await(op, T(G + "GattCommunicationStatus")).ToString();
  }

  public static void Close() { try { if (dev != null) ((IDisposable)dev).Dispose(); } catch { } }
}
