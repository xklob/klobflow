package com.caleb.klobflow

import kotlin.math.*
import org.json.JSONObject

data class BackgroundStatus(val state:String="off",val remainingMs:Long=0) {
    fun json()=JSONObject().put("state",state).put("remainingMs",remainingMs)
}

/** Fixed local baseline. Staves held still after capture remain foreground. */
class BackgroundFilter {
    var status=BackgroundStatus();private set
    private var baseline:IntArray?=null
    private var sums:IntArray?=null
    private var key:String?=null
    private var deadline:Long?=null
    private var captureAt:Long?=null
    private var count=0
    fun clear(){baseline=null;sums=null;key=null;deadline=null;captureAt=null;count=0;status=BackgroundStatus()}
    fun begin(time:Long){clear();deadline=time+5000;status=BackgroundStatus("countdown",5000)}
    fun apply(pixels:IntArray,w:Int,h:Int,time:Long,view:String):IntArray {
        val nextKey="$w:$h:$view"
        if(key!=null&&key!=nextKey)clear()
        key=nextKey
        deadline?.let {end->
            if(time<end){status=BackgroundStatus("countdown",end-time);return IntArray(pixels.size)}
            if(captureAt==null)captureAt=time
            if(sums==null)sums=IntArray(pixels.size*3)
            val total=sums!!;count++
            for(i in pixels.indices){val p=pixels[i];total[i*3]+=p ushr 16 and 255;total[i*3+1]+=p ushr 8 and 255;total[i*3+2]+=p and 255}
            status=BackgroundStatus("capturing",max(0,400-(time-captureAt!!)))
            if(time-captureAt!!>=400&&count>=4){
                baseline=IntArray(pixels.size){i->(255 shl 24) or ((total[i*3].toDouble()/count).roundToInt() shl 16) or ((total[i*3+1].toDouble()/count).roundToInt() shl 8) or (total[i*3+2].toDouble()/count).roundToInt()}
                sums=null;deadline=null;status=BackgroundStatus("ready")
            }
            return IntArray(pixels.size)
        }
        val saved=baseline ?: return pixels
        return IntArray(pixels.size){i->val p=pixels[i];val b=saved[i]
            val pr=p ushr 16 and 255;val pg=p ushr 8 and 255;val pb=p and 255;val br=b ushr 16 and 255;val bg=b ushr 8 and 255;val bb=b and 255
            val hi=max(pr,max(pg,pb));val baseHi=max(br,max(bg,bb))
            val same=max(abs(pr-br),max(abs(pg-bg),abs(pb-bb)))<=32
            val sameLight=baseHi>=48&&hi>=24&&hi<=baseHi*1.4+16&&max(abs(pr.toDouble()/hi-br.toDouble()/baseHi),max(abs(pg.toDouble()/hi-bg.toDouble()/baseHi),abs(pb.toDouble()/hi-bb.toDouble()/baseHi)))<=.14
            if(same||sameLight)0 else p
        }
    }
}
