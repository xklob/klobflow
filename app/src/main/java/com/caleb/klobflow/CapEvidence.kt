package com.caleb.klobflow

import kotlin.math.*

/** Symmetric detector evidence, preserved by copies/reversal and excluded from Segment.json(). */
data class CapEvidence(val pixelLength:Double,val minWidth:Double,val maxWidth:Double,val neutralPeak:Double)

internal fun measureCapEvidence(pixels:IntArray,w:Int,h:Int,segment:Segment):CapEvidence? {
    val unit=min(w,h).toDouble();val a=segment.a*unit;val b=segment.b*unit
    val pixelLength=a.distance(b)
    if(!pixelLength.isFinite() || pixelLength<=0)return null
    val u=P((b.x-a.x)/pixelLength,(b.y-a.y)/pixelLength);val depth=min(12.0,pixelLength*.1);val halfWidth=min(8.0,pixelLength*.06)
    val widths=DoubleArray(2);val peaks=DoubleArray(2)
    for(end in 0..1) {
        val start=if(end==0)a else b;val direction=if(end==0)u else u*(-1.0)
        val normal=P(-direction.y,direction.x)
        val corners=listOf(start-normal*halfWidth,start+normal*halfWidth,
            start+direction*depth-normal*halfWidth,start+direction*depth+normal*halfWidth)
        val x0=max(0,floor(corners.minOf {it.x}).toInt());val x1=min(w-1,ceil(corners.maxOf {it.x}).toInt())
        val y0=max(0,floor(corners.minOf {it.y}).toInt());val y1=min(h-1,ceil(corners.maxOf {it.y}).toInt())
        var area=0;var peak=0.0
        for(y in y0..y1)for(x in x0..x1) {
            val rx=x-start.x;val ry=y-start.y;val along=rx*direction.x+ry*direction.y
            val across= -rx*direction.y+ry*direction.x
            if(along<0 || along>=depth || abs(across)>halfWidth)continue
            val p=pixels[y*w+x];val r=p ushr 16 and 255;val g=p ushr 8 and 255;val blue=p and 255
            val high=max(r,max(g,blue));val low=min(r,min(g,blue));val neutral=low+.25*(high-low)
            peak=max(peak,neutral);if(neutral>=210)area++
        }
        widths[end]=area/depth;peaks[end]=peak
    }
    return CapEvidence(pixelLength,widths.min(),widths.max(),peaks.min())
}
