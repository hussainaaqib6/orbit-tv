package com.matrixstreams.player;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrbitPlayerPlugin.class);
        super.onCreate(savedInstanceState);
        // Whatever shows through the see-through page round the video (for instance the thin gaps
        // round the mini screen) is black, never the theme's light grey.
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));
        hideSystemBars();
    }

    /**
     * Phones and tablets: full screen like a video app. The status bar (clock, notifications) and the
     * navigation buttons are hidden; a swipe from the edge shows them for a moment. (TVs have none.)
     */
    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.hide(WindowInsetsCompat.Type.systemBars());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Coming back from a dialog, the keyboard or another app can bring the bars back.
        if (hasFocus) hideSystemBars();
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
