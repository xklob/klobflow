package com.caleb.klobflow

import android.os.Handler
import android.os.Looper
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicitly enabled local endpoint for LAN or an ADB USB tunnel. No browser-origin access. */
class PhoneServer(private val engine:FlowEngine):NanoHTTPD("0.0.0.0",8787) {
    private val main=Handler(Looper.getMainLooper())
    override fun serve(session:IHTTPSession):Response {
        fun json(status:Response.Status,value:JSONObject)=newFixedLengthResponse(status,"application/json",value.toString()).apply {addHeader("Cache-Control","no-store");addHeader("X-Content-Type-Options","nosniff")}
        fun error(status:Response.Status,text:String)=json(status,JSONObject().put("error",text))
        if(session.headers["origin"]!=null)return error(Response.Status.FORBIDDEN,"Use the localhost companion")
        return try {
            when {
                session.method==Method.GET && session.uri=="/api/stream"->newChunkedResponse(Response.Status.OK,"application/x-klobflow-stream",engine.stream.open()).apply {
                    addHeader("Cache-Control","no-store");addHeader("X-Content-Type-Options","nosniff")
                }
                session.method==Method.GET && session.uri=="/api/live"->json(Response.Status.OK,engine.liveJson())
                session.method==Method.GET && session.uri=="/api/sessions"->json(Response.Status.OK,JSONObject().put("sessions",engine.sessionsJson()))
                session.method==Method.GET && session.uri=="/api/session"->{
                    val file=engine.sessionFile(session.parameters["id"]?.firstOrNull() ?: "")
                    newFixedLengthResponse(Response.Status.OK,"application/x-ndjson",file.inputStream(),file.length()).apply {addHeader("Cache-Control","no-store");addHeader("Content-Disposition","attachment; filename=\"${file.name}\"")}
                }
                session.method==Method.POST && session.uri=="/api/control"->{
                    val length=session.headers["content-length"]?.toLongOrNull()
                    require(length!=null && length in 1..8192){"Control request is too large or missing length"}
                    require(session.headers["content-type"]?.startsWith("application/json")==true){"JSON required"}
                    val body=HashMap<String,String>();session.parseBody(body)
                    val command=JSONObject(body["postData"] ?: "{}")
                    val latch=CountDownLatch(1);var failure:Exception?=null
                    val action=Runnable {try {engine.command(command)}catch(e:Exception){failure=e}finally{latch.countDown()}}
                    main.post(action)
                    if(!latch.await(4,TimeUnit.SECONDS)){main.removeCallbacks(action);error(Response.Status.SERVICE_UNAVAILABLE,"Phone is busy; check its state before retrying")}
                    else if(failure!=null)error(Response.Status.BAD_REQUEST,failure?.message ?: "Invalid command")
                    else json(Response.Status.OK,JSONObject().put("ok",true).put("config",engine.config.json()))
                }
                else->error(Response.Status.NOT_FOUND,"Not found")
            }
        }catch(e:Exception){error(Response.Status.BAD_REQUEST,e.message ?: "Invalid request")}
    }
}
