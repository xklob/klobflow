package com.caleb.klobflow

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.*
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.concurrent.thread
import kotlin.math.max

object PhoneAudio {
    private val mutable=MutableStateFlow(AudioTempo())
    val state=mutable.asStateFlow()
    fun publish(value:AudioTempo){mutable.value=value}
    fun report(message:String){mutable.value=AudioTempo(status=message)}
}
/** Captures only user-approved playback audio. Screen pixels and raw audio are never saved. */
class PlaybackTempoService:Service() {
    private var projection:MediaProjection?=null
    private var callback:MediaProjection.Callback?=null
    private var recorder:AudioRecord?=null
    @Volatile private var closing=false
    private var workerStarted=false
    private val stateLock=Any()
    override fun onBind(intent:Intent?)=null
    override fun onCreate(){super.onCreate();getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("tempo","System audio tempo",NotificationManager.IMPORTANCE_LOW))}
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent==null || intent.action=="STOP"){shutdown();return START_NOT_STICKY}
        if(projection!=null)return START_NOT_STICKY
        val consent=if(Build.VERSION.SDK_INT>=33)intent.getParcelableExtra("consent",Intent::class.java)else @Suppress("DEPRECATION") (intent.getParcelableExtra("consent") as? Intent)
        if(consent==null){shutdown();return START_NOT_STICKY}
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop=PendingIntent.getService(this,1,Intent(this,javaClass).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification=Notification.Builder(this,"tempo").setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Klobflow is detecting system-audio tempo").setContentText("Analyzed locally. Tap Stop to end audio capture.").setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null,"Stop",stop).build()).build()
        try {
            startForeground(51,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            val capture=requireNotNull(getSystemService(MediaProjectionManager::class.java).getMediaProjection(Activity.RESULT_OK,consent));projection=capture
            callback=object:MediaProjection.Callback(){override fun onStop(){shutdown()}}.also {capture.registerCallback(it,Handler(Looper.getMainLooper()))}
            if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)error("Audio permission is required")
            val config=AudioPlaybackCaptureConfiguration.Builder(capture).addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build()
            fun create(mask:Int)=AudioRecord.Builder().setAudioPlaybackCaptureConfig(config).setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(48000).setChannelMask(mask).build()).setBufferSizeInBytes(max(15360,AudioRecord.getMinBufferSize(48000,mask,AudioFormat.ENCODING_PCM_16BIT)*2)).build()
            val stereo=runCatching {create(AudioFormat.CHANNEL_IN_STEREO)}.getOrNull()
            val input=if(stereo?.state==AudioRecord.STATE_INITIALIZED)stereo else {stereo?.release();create(AudioFormat.CHANNEL_IN_MONO)}
            recorder=input;check(input.state==AudioRecord.STATE_INITIALIZED){"Playback audio could not initialize"}
            input.startRecording();PhoneAudio.publish(AudioTempo(running=true,status="Listening for system audio…"))
            workerStarted=true
            thread(name="Klobflow tempo",isDaemon=true){
                val channels=input.channelCount;val samples=ShortArray(960*channels);val envelope=AudioEnvelope();val analyzer=TempoAnalyzer();val stamp=AudioTimestamp();val sampleClock=AudioSampleClock()
                var readFrames=0L;var offset=0
                try {
                    while(!closing){
                        val n=input.read(samples,offset,samples.size-offset,AudioRecord.READ_BLOCKING);if(n<0)error("Playback capture disconnected");if(n==0)continue;offset+=n
                        if(offset<samples.size)continue
                        val now=SystemClock.elapsedRealtime().toDouble()
                        var hardwareOrigin:Double?=null
                        if(input.getTimestamp(stamp,AudioTimestamp.TIMEBASE_MONOTONIC)==AudioRecord.SUCCESS){
                            val clockOffset=(SystemClock.elapsedRealtimeNanos()-System.nanoTime())/1e6
                            hardwareOrigin=stamp.nanoTime/1e6+clockOffset-stamp.framePosition*1000.0/48000
                        }
                        val blockEnd=sampleClock.endTime(readFrames+960,now,hardwareOrigin)
                        var result:AudioTempo?=null
                        for(i in 0 until 960){var value=0.0;for(c in 0 until channels)value+=samples[i*channels+c]/32768.0;val energy=envelope.sample(value/channels);if(energy!=null)result=analyzer.observe(blockEnd-(959-i)*1000.0/48000,energy)}
                        readFrames+=960;offset=0
                        if(result!=null)synchronized(stateLock){if(!closing)PhoneAudio.publish(result)}
                    }
                }catch(e:Exception){if(!closing)Handler(Looper.getMainLooper()).post {shutdown();PhoneAudio.report("Audio capture ended. Connect system audio again.")}}
                finally {runCatching {input.stop()};input.release()}
            }
        }catch(e:Exception){shutdown();PhoneAudio.report("Could not capture system audio: ${e.message ?: "try again"}")}
        return START_NOT_STICKY
    }
    private fun shutdown(){
        synchronized(stateLock){if(closing)return;closing=true;PhoneAudio.report("Audio stopped. Connect again or use manual BPM.")}
        runCatching {recorder?.stop()};if(!workerStarted)recorder?.release();recorder=null
        callback?.let {projection?.unregisterCallback(it)};callback=null;projection?.stop();projection=null
        PhoneAudio.report("Audio stopped. Connect again or use manual BPM.");stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()
    }
    override fun onTaskRemoved(rootIntent:Intent?){shutdown();super.onTaskRemoved(rootIntent)}
    override fun onDestroy(){shutdown();super.onDestroy()}
}
