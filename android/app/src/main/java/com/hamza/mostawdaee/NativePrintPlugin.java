package com.hamza.mostawdaee;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * window.print() does nothing inside the Capacitor WebView, so invoices and statements are
 * rendered in an off-screen WebView and handed to Android's PrintManager (print or save as PDF).
 */
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {
    // Held until the print job has its document; a collected WebView aborts the job.
    private WebView printView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String jobName = call.getString("jobName", "Mostawdaee");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getActivity());
            view.getSettings().setJavaScriptEnabled(false);
            view.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public void onPageFinished(WebView webView, String url) {
                    if (started) return;
                    started = true;
                    PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    if (manager == null) {
                        printView = null;
                        call.reject("Printing is not available on this device");
                        return;
                    }
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                    manager.print(jobName, adapter, new PrintAttributes.Builder().build());
                    call.resolve();
                }
            });
            printView = view;
            view.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }
}
