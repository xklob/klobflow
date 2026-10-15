package com.caleb.klobflow.motion

import fi.iki.elonen.NanoHTTPD

class CameraServer(private val camera:CameraHost,private val frames:FrameStream):NanoHTTPD("0.0.0.0",8787) {
    override fun serve(session:IHTTPSession):Response {
        if(session.headers["origin"]!=null)return newFixedLengthResponse(Response.Status.FORBIDDEN,"text/plain","Use the localhost companion")
        val response=when {
            session.method==Method.GET && session.uri=="/api/live"->newFixedLengthResponse(Response.Status.OK,"application/json",camera.liveJson().toString())
            session.method==Method.GET && session.uri=="/api/stream"->newChunkedResponse(Response.Status.OK,"application/x-klobflow-stream",frames.open())
            else->newFixedLengthResponse(Response.Status.NOT_FOUND,"text/plain","Not found")
        }
        response.addHeader("Cache-Control","no-store");response.addHeader("X-Content-Type-Options","nosniff")
        return response
    }
}
