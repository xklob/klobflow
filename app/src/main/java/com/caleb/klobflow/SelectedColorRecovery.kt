package com.caleb.klobflow

import kotlin.math.*

// A selected hue can identify a cap even when its white shaft touches sunlight
// and is removed by the color mask. Recover only fresh, supported raw geometry.
private fun sharpColorCandidate(s:Segment)=!s.blurred&&!s.occluded&&s.confidence>=.8
private fun selectedHue(pixel:Int,threshold:Int):Boolean {
    val hi=max(pixel ushr 16 and 255,max(pixel ushr 8 and 255,pixel and 255))
    val lo=min(pixel ushr 16 and 255,min(pixel ushr 8 and 255,pixel and 255))
    return hi>=threshold&&hi-lo>hi*.2
}

private fun colorBeyondEnd(filtered:IntArray,w:Int,h:Int,s:Segment,threshold:Int):Boolean {
    val unit=min(w,h).toDouble();val len=s.length*unit
    if(!(len>0))return false
    val dx=(s.b.x-s.a.x)*unit/len;val dy=(s.b.y-s.a.y)*unit/len
    for((p,sign) in listOf(s.a to -1,s.b to 1)){
        val px=p.x*unit;val py=p.y*unit;var hits=0;var step=max(8.0,len*.08)
        while(step<=len*.50){
            for(across in -4..4){
                val x=(px+sign*dx*step-dy*across).roundToInt();val y=(py+sign*dy*step+dx*across).roundToInt()
                if(x in 0 until w&&y in 0 until h&&selectedHue(filtered[y*w+x],threshold)&&++hits>=6)return true
            }
            step++
        }
    }
    return false
}

private fun supportedColorCap(filtered:IntArray,w:Int,h:Int,p:P,dx:Double,dy:Double,allowClipped:Boolean=false):Boolean {
    val unit=min(w,h).toDouble();val px=p.x*unit;val py=p.y*unit;val radius=4.0
    // A clipped neighborhood cannot establish a fully visible cap.
    if(px<0||py<0||px>w-1||py>h-1)return false
    if(!allowClipped&&(px<radius||py<radius||px>w-1-radius||py>h-1-radius))return false
    var hits=0;var positive=0;var negative=0
    for(y in max(0,floor(py-radius).toInt())..min(h-1,ceil(py+radius).toInt()))
        for(x in max(0,floor(px-radius).toInt())..min(w-1,ceil(px+radius).toInt())){
            if(hypot(x-px,y-py)>radius||!selectedHue(filtered[y*w+x],80))continue
            val across=-(x-px)*dy+(y-py)*dx
            hits++;if(across>=.75)positive++;if(across<=-.75)negative++
            // A colored reflection on one side of a white line is not a cap.
            if(hits>=6&&positive>=2&&negative>=2)return true
        }
    return false
}

internal fun recoverSelectedColorEndpoints(filtered:IntArray,w:Int,h:Int,c:Config,selected:List<Segment>,detectRaw:()->List<Segment>):List<Segment> {
    if(!c.led||c.staffColors.isEmpty()||"white" in c.staffColors||
        selected.none {sharpColorCandidate(it)&&colorBeyondEnd(filtered,w,h,it,c.threshold)})return selected
    // The corridor scan only triggers work. Actual evidence uses distinct pixels
    // around both ends of a newly detected segment, never a prior staff length.
    val raw=detectRaw();val used=BooleanArray(raw.size);val unit=min(w,h).toDouble()
    return selected.map {s->
        val sl=s.length
        if(!sharpColorCandidate(s)||!(sl>0))return@map s
        val dx=(s.b.x-s.a.x)/sl;val dy=(s.b.y-s.a.y)/sl
        var chosen=-1;var chosenLength=Double.POSITIVE_INFINITY;var contradiction=false
        for(i in raw.indices){
            val r=raw[i];val rl=r.length
            if(used[i]||!sharpColorCandidate(r)||rl<sl*1.10||rl>sl*1.40||angleDifference(s.angle,r.angle)>.12)continue
            var a=r.a;var b=r.b
            if(s.a.distance(b)+s.b.distance(a)<s.a.distance(a)+s.b.distance(b)){a=r.b;b=r.a}
            if(min(s.a.distance(a),s.b.distance(b))>max(4/unit,sl*.025))continue
            val low=(a.x-s.a.x)*dx+(a.y-s.a.y)*dy;val high=(b.x-s.a.x)*dx+(b.y-s.a.y)*dy
            val rawDx=(b.x-a.x)/rl;val rawDy=(b.y-a.y)/rl
            if(low>sl*.04||high<sl*.96)continue
            if(!supportedColorCap(filtered,w,h,a,rawDx,rawDy)||!supportedColorCap(filtered,w,h,b,rawDx,rawDy)){
                if(supportedColorCap(filtered,w,h,a,rawDx,rawDy,true)&&supportedColorCap(filtered,w,h,b,rawDx,rawDy,true))contradiction=true
                continue
            }
            if(rl<chosenLength){chosen=i;chosenLength=rl}
        }
        // A clipped cap can contradict the shortened span without proving a
        // precise endpoint. Lower confidence without inventing motion blur.
        if(chosen<0){if(contradiction)s.copy(confidence=min(.5,s.confidence))else s}
        else {used[chosen]=true;raw[chosen].copy(confidence=min(.7,raw[chosen].confidence))}
    }
}
