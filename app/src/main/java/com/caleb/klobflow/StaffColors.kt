package com.caleb.klobflow

import kotlin.math.*

val staffColorNames=listOf("red","orange","yellow","green","cyan","blue","purple","pink","white")

/** Selected LED hues and their overexposed white cores. Does not infer identity from color. */
fun filterStaffColors(pixels:IntArray,w:Int,h:Int,colors:List<String>):IntArray {
    if(colors.isEmpty())return pixels
    val selected=colors.toSet();val matched=BooleanArray(w*h);val neutral=BooleanArray(w*h)
    val stride=w+1;val integral=IntArray(stride*(h+1));val hasWhite="white" in selected
    for(y in 0 until h){var row=0
        for(x in 0 until w){val i=y*w+x;val p=pixels[i];val r=p ushr 16 and 255;val g=p ushr 8 and 255;val b=p and 255
            val hi=max(r,max(g,b));val lo=min(r,min(g,b));val delta=hi-lo
            val pale=hi>=24&&delta<=hi*.2;neutral[i]=pale
            var match=false
            if(hi>=24&&delta>hi*.2){
                val hue=(((when(hi){r->(g-b).toDouble()/delta;g->(b-r).toDouble()/delta+2;else->(r-g).toDouble()/delta+4})*60+360)%360)
                match=("red" in selected&&(hue<25||hue>=345))||("orange" in selected&&hue>=20&&hue<48)||("yellow" in selected&&hue>=42&&hue<75)||("green" in selected&&hue>=70&&hue<165)||("cyan" in selected&&hue>=160&&hue<200)||("blue" in selected&&hue>=195&&hue<260)||("purple" in selected&&hue>=255&&hue<295)||("pink" in selected&&hue>=290&&hue<350)
            }
            matched[i]=match||(hasWhite&&pale)
            if(match)row++;integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row
        }
    }
    val out=IntArray(pixels.size);val radius=3
    for(y in 0 until h)for(x in 0 until w){val i=y*w+x
        if(matched[i]){out[i]=pixels[i];continue}
        if(!neutral[i])continue
        val left=max(0,x-radius);val right=min(w,x+radius+1);val top=max(0,y-radius);val bottom=min(h,y+radius+1)
        val nearby=integral[bottom*stride+right]-integral[top*stride+right]-integral[bottom*stride+left]+integral[top*stride+left]
        if(nearby>=2)out[i]=pixels[i]
    }
    // A three-pixel hue allowance can hollow out large overexposed end caps.
    // Fill only bounded bright cores whose boundary is supported by selected hue.
    // One nearby colored spot must not admit an entire white window or room light.
    if(!hasWhite){
        fun high(p:Int)=max(p ushr 16 and 255,max(p ushr 8 and 255,p and 255))
        val bright=BooleanArray(pixels.size){neutral[it]&&high(pixels[it])>=160}
        val visited=BooleanArray(pixels.size);val queue=IntArray(pixels.size)
        for(first in pixels.indices)if(bright[first]&&!visited[first]){
            var head=0;var tail=1;var boundary=0;var supported=0;var clipped=false
            queue[0]=first;visited[first]=true
            while(head<tail){
                val at=queue[head++];val x=at%w;val y=at/w
                if(x==0||x==w-1||y==0||y==h-1)clipped=true
                var edge=false;var color=false
                for(dy in -1..1)for(dx in -1..1){
                    val xx=x+dx;val yy=y+dy;if(xx !in 0 until w||yy !in 0 until h)continue
                    val i=yy*w+xx
                    if(bright[i]){if(!visited[i]){visited[i]=true;queue[tail++]=i}}
                    else{edge=true;if(matched[i]&&high(pixels[i])>=80)color=true}
                }
                if(edge){boundary++;if(color)supported++}
            }
            if(!clipped&&tail<=w*h*.03&&boundary>0&&supported.toDouble()/boundary>=.35)
                for(i in 0 until tail)out[queue[i]]=pixels[queue[i]]
        }
    }
    return out
}
