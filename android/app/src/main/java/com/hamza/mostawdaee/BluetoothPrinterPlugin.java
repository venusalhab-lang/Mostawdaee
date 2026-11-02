package com.hamza.mostawdaee;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sends ready-made ESC/POS bytes to a receipt printer paired in Android's Bluetooth settings
 * (classic Bluetooth, serial port profile). The app builds the bytes; this class only moves them.
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = { @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth") }
)
public class BluetoothPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CHUNK = 512;
    // One job at a time: two sockets to the same printer interleave and garble both receipts.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "listAfterPermission");
            return;
        }
        listNow(call);
    }

    @PermissionCallback
    private void listAfterPermission(PluginCall call) {
        if (needsPermission()) {
            call.reject("Bluetooth permission denied", "permission-denied");
            return;
        }
        listNow(call);
    }

    @SuppressLint("MissingPermission")
    private void listNow(PluginCall call) {
        BluetoothAdapter bt = adapter();
        if (bt == null) {
            call.reject("This device has no Bluetooth", "unavailable");
            return;
        }
        if (!bt.isEnabled()) {
            call.reject("Bluetooth is off", "disabled");
            return;
        }
        JSArray devices = new JSArray();
        for (BluetoothDevice device : bt.getBondedDevices()) {
            JSObject item = new JSObject();
            item.put("name", device.getName() == null ? device.getAddress() : device.getName());
            item.put("address", device.getAddress());
            BluetoothClass cls = device.getBluetoothClass();
            item.put("printer", cls != null && cls.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING);
            devices.put(item);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "printAfterPermission");
            return;
        }
        printNow(call);
    }

    @PermissionCallback
    private void printAfterPermission(PluginCall call) {
        if (needsPermission()) {
            call.reject("Bluetooth permission denied", "permission-denied");
            return;
        }
        printNow(call);
    }

    @SuppressLint("MissingPermission")
    private void printNow(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address) || data == null || data.isEmpty()) {
            call.reject("address and data are required", "invalid");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("data is not base64", "invalid");
            return;
        }
        BluetoothAdapter bt = adapter();
        if (bt == null) {
            call.reject("This device has no Bluetooth", "unavailable");
            return;
        }
        if (!bt.isEnabled()) {
            call.reject("Bluetooth is off", "disabled");
            return;
        }
        worker.execute(() -> {
            BluetoothDevice device = bt.getRemoteDevice(address);
            // Discovery slows RFCOMM connects; from Android 12 cancelling it needs a scan permission the app does not ask for.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) bt.cancelDiscovery();
            BluetoothSocket socket = null;
            try {
                socket = connect(device);
                OutputStream out = socket.getOutputStream();
                for (int i = 0; i < bytes.length; i += CHUNK) {
                    out.write(bytes, i, Math.min(CHUNK, bytes.length - i));
                    out.flush();
                    // Cheap printers drop data when their small buffer is flooded.
                    Thread.sleep(15);
                }
                // Closing too early cuts off the tail of the job on some printers.
                Thread.sleep(400);
                call.resolve();
            } catch (IOException e) {
                call.reject("Could not reach the printer: " + e.getMessage(), "connect-failed");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                call.reject("Printing was interrupted", "interrupted");
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (IOException ignored) { }
                }
            }
        });
    }

    @SuppressLint("MissingPermission")
    private BluetoothSocket connect(BluetoothDevice device) throws IOException {
        BluetoothSocket secure = device.createRfcommSocketToServiceRecord(SPP);
        try {
            secure.connect();
            return secure;
        } catch (IOException secureFailed) {
            try { secure.close(); } catch (IOException ignored) { }
            // Many receipt printers only accept an insecure RFCOMM link.
            BluetoothSocket socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
            socket.connect();
            return socket;
        }
    }
}
