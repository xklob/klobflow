package com.caleb.klobflow.motion

import java.io.DataInputStream
import org.junit.Assert.*
import org.junit.Test

class FrameStreamTest {
    @Test fun framingAndSlowViewerKeepsOnlyLatestPacket(){
        val stream=FrameStream();stream.start();val input=DataInputStream(stream.open())
        stream.publish("first",byteArrayOf(1))
        stream.publish("latest",byteArrayOf(2,3))
        assertEquals(6,input.readInt());assertEquals(2,input.readInt())
        val json=ByteArray(6);input.readFully(json);assertEquals("latest",String(json))
        assertEquals(2,input.read());assertEquals(3,input.read());input.close();stream.stop()
    }
    @Test fun oldStreamEndsAfterSharingRestarts(){
        val stream=FrameStream();stream.start();val old=stream.open();stream.stop();stream.start()
        stream.publish("new",byteArrayOf(1));assertEquals(-1,old.read());old.close();stream.stop()
    }
}
