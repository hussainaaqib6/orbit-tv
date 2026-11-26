package com.matrixstreams.player;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrbitPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Remote keys such as Back, Menu, Play/Pause, Fast-forward, Channel up/down and the colour buttons
     * either never reach the WebView or are acted on by Android before the app sees them. Hand them to
     * the web layer, which decides what each one does on the current screen.
     * D-pad arrows, OK and number keys still go to the WebView as normal key events.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        OrbitPlayerPlugin p = OrbitPlayerPlugin.instance;
        if (p != null && p.onKey(event)) return true;
        return super.dispatchKeyEvent(event);
    }
}
