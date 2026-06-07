package `in`.co.qpms.myqpms_fo_v2

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createTrackingNotificationChannel()
    }

    private fun createTrackingNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            "myqpms_tracking",
            "MyQPMS FO tracking",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Location, KM and attendance are being recorded"
        }
        getSystemService(NotificationManager::class.java)
            ?.createNotificationChannel(channel)
    }
}
