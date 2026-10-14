package com.caleb.klobflow

import java.io.InputStream
import java.nio.ByteBuffer

/** A single latest packet, shared by viewers. Slow viewers skip frames instead of queuing them. */
class FrameStream {
    private val lock=Object()
    private var latest=ByteArray(8)
    private var sequence=0L
    private var generation=0L
    private var enabled=false
    fun start()=synchronized(lock){enabled=true;generation++;latest=ByteArray(8);sequence++;lock.notifyAll()}
    fun stop()=synchronized(lock){enabled=false;generation++;latest=ByteArray(8);lock.notifyAll()}
    fun publish(metadata:String,jpeg:ByteArray) {
        val json=metadata.toByteArray(Charsets.UTF_8)
        val bytes=ByteBuffer.allocate(8+json.size+jpeg.size).putInt(json.size).putInt(jpeg.size).put(json).put(jpeg).array()
        synchronized(lock){if(enabled){latest=bytes;sequence++;lock.notifyAll()}}
    }
    fun open():InputStream {
        val opened=synchronized(lock){generation}
        return object:InputStream(){
            private var seen=-1L
            private var packet=ByteArray(0)
            private var offset=0
            @Volatile private var closed=false
            override fun read():Int {val one=ByteArray(1);return if(read(one,0,1)<0)-1 else one[0].toInt() and 255}
            override fun read(bytes:ByteArray,start:Int,length:Int):Int {
                if(length==0)return 0
                if(offset==packet.size){
                    synchronized(lock){
                        if(enabled && !closed && generation==opened && sequence==seen)lock.wait(500)
                        if(!enabled || closed || generation!=opened)return -1
                        packet=if(sequence==seen)ByteArray(8) else latest
                        seen=sequence;offset=0
                    }
                }
                val count=minOf(length,packet.size-offset)
                packet.copyInto(bytes,start,offset,offset+count);offset+=count
                return count
            }
            override fun close(){closed=true;synchronized(lock){lock.notifyAll()}}
        }
    }
}
