package com.caleb.klobflow

import android.media.MediaMetadataRetriever
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL

@RunWith(AndroidJUnit4::class)
class FlowDeviceTest {
    private fun await(timeout:Long=15000,condition:()->Boolean){val end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if(condition())return;Thread.sleep(150)};assertTrue("Timed out",condition())}
    @Test fun liveDetectorSharingControlAndRealCameraRecording() {
        val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
        instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.CAMERA").close()
        ActivityScenario.launch(MainActivity::class.java).use {scenario->
            lateinit var engine:FlowEngine
            scenario.onActivity {engine=it.engine;engine.startDemo();engine.share(true)}
            await {engine.ui.value.frame?.staffs?.count {it!=null && it.confidence>=.55}==2}
            val token=engine.ui.value.pairCode
            fun request(route:String,auth:Boolean=true,body:String?=null):Pair<Int,String>{
                val socket=java.net.Socket("127.0.0.1",8787);socket.soTimeout=6000
                val payload=body?.toByteArray() ?: byteArrayOf()
                val headers=buildString {
                    append("${if(body==null)"GET" else "POST"} $route HTTP/1.1\r\nHost: 127.0.0.1:8787\r\nConnection: close\r\n")
                    if(auth)append("X-Klobflow-Token: $token\r\n")
                    if(body!=null)append("Content-Type: application/json\r\nContent-Length: ${payload.size}\r\n")
                    append("\r\n")
                }
                socket.getOutputStream().apply {write(headers.toByteArray());write(payload);flush()}
                val raw=socket.getInputStream().bufferedReader().use {it.readText()};socket.close()
                return raw.substringBefore("\r\n").split(" ")[1].toInt() to raw.substringAfter("\r\n\r\n")
            }
            assertEquals(401,request("/api/live",false).first)
            val live=JSONObject(request("/api/live").second);assertEquals("demo",live.getString("source"));assertTrue(live.getString("image").length>1000)
            assertEquals(200,request("/api/control",body="""{"action":"config","config":{"mode":"cube"}}""").first)
            await {engine.ui.value.frame?.guide?.config?.mode=="cube"}
            assertEquals(400,request("/api/control",body="""{"action":"config","config":{"scale":-1}}""").first)
            scenario.onActivity {engine.share(false);engine.updateConfig(JSONObject().put("facing","back").put("fps",30));engine.bindCamera()}
            await(25000){engine.ui.value.cameraReady && engine.ui.value.frame?.source=="camera"}
            scenario.onActivity {engine.startRecording()}
            await(20000){engine.ui.value.recording && engine.ui.value.elapsed>2500}
            scenario.onActivity {engine.stopRecording()}
            await(20000){!engine.ui.value.finalizing && engine.ui.value.sessions.isNotEmpty()}
            val session=engine.ui.value.sessions.first()
            assertTrue("Recording failed: $session",session.isNull("recordingError"))
            assertTrue(session.getLong("durationMs")>1500)
            assertTrue(engine.sessionFile(session.getString("id")).length()>1000)
            val retriever=MediaMetadataRetriever();retriever.setDataSource(context,android.net.Uri.parse(session.getString("videoUri")))
            assertTrue(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()>1500)
            assertNotNull(retriever.getFrameAtTime(1000000));retriever.release()
        }
    }
}
