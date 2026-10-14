package com.hamza.mostawdaee;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePrintPlugin.class);
        registerPlugin(BluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);
        // Do not override the Capacitor default content view unless a custom layout
        // provides a capacitor_webview container. This prevents the WebView from
        // failing to load in the native Android shell.
    }
}
