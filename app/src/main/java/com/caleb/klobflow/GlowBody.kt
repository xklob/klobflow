package com.caleb.klobflow

import kotlin.math.*

/** Recover visible end caps from the bright shaft inside a larger colored glow.
 * Uses only current pixels. Broad exposure fans, clipped ends and isolated lights
 * without enough shaft support cannot become precise measurements. Browser: core.mjs. */
internal fun glowBodyEndpoints(argb:IntArray,w:Int,h:Int,s:Segment):Segment? {
    val unit=min(w,h).toDouble();val len=s.length*unit;if(len<24)return null
    val ax=s.a.x*unit;val ay=s.a.y*unit;val bx=s.b.x*unit;val by=s.b.y*unit
    val dx=(bx-ax)/len;val dy=(by-ay)/len
    if(minOf(ax,bx,ay,by)<2||max(ax,bx)>w-3||max(ay,by)>h-3)return null
    val margin=min(unit*.12,len*.18);val points=ArrayList<DoubleArray>();var peak=0.0
    for(y in max(1,floor(min(ay,by)-margin).toInt())..min(h-2,ceil(max(ay,by)+margin).toInt()))
        for(x in max(1,floor(min(ax,bx)-margin).toInt())..min(w-2,ceil(max(ax,bx)+margin).toInt())) {
            val along=(x-ax)*dx+(y-ay)*dy;val across=-(x-ax)*dy+(y-ay)*dx
            if(along < -len*.06||along>len*1.06||abs(across)>margin)continue
            val p=argb[y*w+x];val hi=maxOf(p ushr 16 and 255,p ushr 8 and 255,p and 255);val lo=minOf(p ushr 16 and 255,p ushr 8 and 255,p and 255)
            val light=lo+(hi-lo)*.25;if(hi<80)continue
            points.add(doubleArrayOf(x.toDouble(),y.toDouble(),light,0.0,0.0));peak=max(peak,light)
        }
    if(peak<45)return null
    val floor=peak*.72;val remaining=points.filter {it[2]>=floor}.associateBy {it[1].toInt()*w+it[0].toInt()}.toMutableMap()
    val parts=ArrayList<List<DoubleArray>>()
    // Keep the shaft's bright connected pieces; detached reflections cannot extend its caps.
    while(remaining.isNotEmpty()) {
        val first=remaining.keys.first();val queue=arrayListOf(first);val part=arrayListOf(remaining.remove(first)!!);var n=0
        while(n<queue.size){val at=queue[n++];for(oy in -1..1)for(ox in -1..1){
            val i=at+oy*w+ox;val p=remaining.remove(i) ?: continue;queue.add(i);part.add(p)
        }}
        if(part.size>=6)parts.add(part)
    }
    parts.sortByDescending {it.size};val core=parts.take(2).flatten();if(core.size<18)return null
    var mass=0.0;var mx=0.0;var my=0.0
    for(p in core){mass+=p[2];mx+=p[0]*p[2];my+=p[1]*p[2]};mx/=mass;my/=mass
    var xx=0.0;var xy=0.0;var yy=0.0
    for(p in core){xx+=(p[0]-mx).pow(2)*p[2];xy+=(p[0]-mx)*(p[1]-my)*p[2];yy+=(p[1]-my).pow(2)*p[2]};xx/=mass;xy/=mass;yy/=mass
    val theta=.5*atan2(2*xy,xx-yy);val ux=cos(theta);val uy=sin(theta)
    if(angleDifference(theta,s.angle)>.20)return null
    var low=Double.POSITIVE_INFINITY;var high=Double.NEGATIVE_INFINITY
    for(p in core){p[3]=(p[0]-mx)*ux+(p[1]-my)*uy;p[4]=-(p[0]-mx)*uy+(p[1]-my)*ux;low=min(low,p[3]);high=max(high,p[3])}
    val extent=high-low;if(extent<len*.82||extent>len*1.12)return null
    data class Bin(var mass:Double=0.0,var side:Double=0.0,var square:Double=0.0,var count:Int=0)
    val bins=List(16){Bin()}
    for(p in core){val b=bins[min(15,floor((p[3]-low)/extent*16).toInt())];b.mass+=p[2];b.side+=p[4]*p[2];b.square+=p[4].pow(2)*p[2];b.count++}
    fun supported(b:Bin)=b.count>=2
    if(bins.take(6).count(::supported)<4||bins.drop(10).count(::supported)<4||bins.count(::supported)<10)return null
    val errorLimit=max(1.5,min(unit*.04,extent*.065))
    for(end in listOf(bins.take(3),bins.drop(13))) {
        val endMass=end.sumOf {it.mass};if(endMass==0.0)return null
        val side=end.sumOf {it.side}/endMass;val variance=end.sumOf {it.square}/endMass-side*side
        if(2*sqrt(max(0.0,variance))>errorLimit||abs(side)>errorLimit)return null
    }
    // A curved crescent can have narrow tips but no single straight shaft.
    if(bins.filter(::supported).any {abs(it.side/it.mass)>errorLimit})return null
    // Use the observed cap across the shaft, not its projection onto the mean axis.
    fun cap(edge:Double):P? {
        val points=core.filter {abs(it[3]-edge)<=min(3.0,extent*.03)};if(points.size<3)return null
        val mass=points.sumOf {it[2]};val side=points.sumOf {it[4]*it[2]}/mass
        return P((mx+ux*edge-uy*side)/unit,(my+uy*edge+ux*side)/unit)
    }
    val a=cap(low) ?: return null;val b=cap(high) ?: return null
    if(minOf(a.x,a.y,b.x,b.y)<2/unit||max(a.x,b.x)>(w-3)/unit||max(a.y,b.y)>(h-3)/unit)return null
    return Segment(a,b,confidence=.7,blurred=false)
}
