package com.caleb.klobflow

import kotlin.math.*

/** Small, deterministic Hough detector. No cloud, trained model, or colored markers. */
class StaffDetector {
    private val angles=180
    private val cosines=DoubleArray(angles){cos(it*PI/angles)}
    private val sines=DoubleArray(angles){sin(it*PI/angles)}
    fun detect(argb: IntArray,w: Int,h: Int,c: Config): List<Segment> {
        require(argb.size==w*h && w>0 && h>0)
        val short=min(w,h).toDouble()
        val mask=BooleanArray(w*h)
        fun value(i:Int):Int {val p=argb[i];return max(p ushr 16 and 255,max(p ushr 8 and 255,p and 255))}
        for(y in 1 until h-1)for(x in 1 until w-1) {
            val i=y*w+x;val p=argb[i];val hi=value(i)
            val lo=min(p ushr 16 and 255,min(p ushr 8 and 255,p and 255))
            mask[i]=if(c.led) hi>=c.threshold && (hi-lo>35 || hi>=min(250,c.threshold+35))
                else abs(value(i+1)-value(i-1))+abs(value(i+w)-value(i-w))>c.threshold/2
        }
        // Vote only from boundary pixels so bright blobs cannot outweigh thin staves by area.
        val pixels=ArrayList<P>()
        for(y in 4 until h-4)for(x in 4 until w-4) {
            val i=y*w+x
            if(mask[i] && (!mask[i-1] || !mask[i+1] || !mask[i-w] || !mask[i+w]))pixels.add(P(x.toDouble(),y.toDouble()))
        }
        if(pixels.size<12)return emptyList()
        val step=max(1,(pixels.size+3499)/3500)
        val diag=ceil(hypot(w.toDouble(),h.toDouble())).toInt()
        val bins=2*diag+1
        val votes=IntArray(angles*bins)
        for(i in pixels.indices step step) {
            val p=pixels[i]
            for(a in 0 until angles){val rho=(p.x*cosines[a]+p.y*sines[a]).roundToInt()+diag;votes[a*bins+rho]++}
        }
        val result=ArrayList<Segment>()
        repeat(28) {
            var maxIndex=0
            for(i in votes.indices)if(votes[i]>votes[maxIndex])maxIndex=i
            val peak=votes[maxIndex];val a=maxIndex/bins;val rho=maxIndex%bins-diag
            if(peak<max(9,(c.minLength*short/step*0.3).toInt()))return@repeat
            // Suppress this peak and nearby parallel edge peaks.
            for(da in -3..3)for(dr in -7..7){
                val raw=a+da;val aa=(raw+angles)%angles
                val rr=(if(raw<0 || raw>=angles)-rho else rho)+dr+diag
                if(rr in 0 until bins)votes[aa*bins+rr]=0
            }
            val n=P(cosines[a],sines[a]);val d=P(-n.y,n.x)
            val projections=pixels.asSequence().filter {abs(it.x*n.x+it.y*n.y-rho)<5.0}.map {it.x*d.x+it.y*d.y}.sorted().toList()
            if(projections.size<12)return@repeat
            // Separate unrelated collinear lights. Allow a short gap for a hand or dark grip.
            var start=0;var bestStart=0;var bestEnd=0
            for(i in 1..projections.size) {
                if(i==projections.size || projections[i]-projections[i-1]>short*0.10) {
                    if(projections[i-1]-projections[start]>projections[bestEnd]-projections[bestStart]){bestStart=start;bestEnd=i-1}
                    start=i
                }
            }
            val low=projections[bestStart];val high=projections[bestEnd];val len=high-low
            if(len<short*c.minLength)return@repeat
            val aa=n*rho.toDouble()+d*low;val bb=n*rho.toDouble()+d*high
            val steps=max(8,len.toInt()/2)
            var covered=0;var narrow=0;var thickness=0.0
            for(i in 0..steps) {
                val p=aa+(bb-aa)*(i.toDouble()/steps)
                var across=0
                for(off in -9..9){val q=p+n*off.toDouble();val xx=q.x.roundToInt();val yy=q.y.roundToInt();if(xx in 0 until w && yy in 0 until h && mask[yy*w+xx])across++}
                if(across>0)covered++
                fun masked(offset:Double):Boolean {val q=p+n*offset;val x=q.x.roundToInt();val y=q.y.roundToInt();return x in 0 until w && y in 0 until h && mask[y*w+x]}
                if(across>0 && !masked(-12.0) && !masked(12.0))narrow++
                thickness+=across
            }
            val support=covered.toDouble()/(steps+1)
            val meanThickness=thickness/(steps+1)
            if(support<0.62 || narrow.toDouble()/(steps+1)<0.55 || meanThickness>15 || len/(meanThickness+1)<7)return@repeat
            val s=Segment(aa*(1/short),bb*(1/short),(support*0.9+0.1*(len/(short*0.6)).coerceAtMost(1.0)).coerceIn(0.0,1.0))
            if(result.none {old->angleDifference(old.angle,s.angle)<0.14 && (distanceToSegment(s.center,old)<0.035 || distanceToSegment(old.center,s)<0.035)})result.add(s)
        }
        return result.sortedByDescending {it.confidence*sqrt(it.length)}.take(8)
    }
}

class StaffTracker {
    private var last=listOf<Segment?>(null,null)
    private var lastAt=longArrayOf(0,0)
    private var streak=intArrayOf(0,0)
    fun reset(){last=listOf(null,null);lastAt=longArrayOf(0,0);streak=intArrayOf(0,0)}
    fun seed(staffs: List<Segment>,t:Long){require(staffs.size in 1..2);last=staffs+List(2-staffs.size){null};lastAt=longArrayOf(t,t);streak=intArrayOf(0,0)}
    fun update(candidates: List<Segment>,t:Long,count:Int=2): List<Segment?> {
        val prior=last.mapIndexed {i,s->s?.takeIf {i<count}?.takeIf {t-lastAt[i]<1500}}
        fun cost(i:Int,s:Segment):Double {
            val p=prior[i] ?: return 0.22-s.confidence*0.1
            val delta=(t-lastAt[i]).coerceAtLeast(1)/1000.0
            val center=p.center.distance(s.center)
            val angle=angleDifference(p.angle,s.angle)
            if(center>0.16+delta*1.8 || angle>0.3+delta*8 || s.length/p.length !in 0.25..1.9)return 10.0
            return center+angle*0.13+abs(ln(s.length/p.length))*0.10+(1-s.confidence)*0.15
        }
        val options=(-1 until candidates.size).toList()
        val assignments=ArrayList<Triple<Int,Int,Double>>()
        for(a in options)for(b in if(count==1)listOf(-1)else options)if(a<0 || b<0 || a!=b) {
            if(a>=0 && b>=0 && distanceToSegment(candidates[a].center,candidates[b])<0.025 && angleDifference(candidates[a].angle,candidates[b].angle)<0.15)continue
            val score=(if(a<0)0.55 else cost(0,candidates[a]))+(if(b<0)0.55 else cost(1,candidates[b]))
            assignments.add(Triple(a,b,score))
        }
        val sorted=assignments.sortedBy {it.third};var best=sorted.first()
        if(prior.all {it==null} && best.first>=0 && best.second>=0 && candidates[best.first].center.x>candidates[best.second].center.x)best=Triple(best.second,best.first,best.third)
        val ambiguous=prior.all {it!=null} && best.first>=0 && best.second>=0 &&
            sorted.any {it.first==best.second && it.second==best.first && it.third-best.third<0.035}
        val selected=listOf(best.first,best.second).mapIndexed {i,index->
            if(index<0){val p=prior[i];val established=streak[i]>=3;streak[i]=0
                if(p!=null && (established || p.occluded))p.copy(confidence=0.3,occluded=true) else null
            }else {
                var s=candidates[index];val p=prior[i]
                if(p!=null && p.a.distance(s.b)+p.b.distance(s.a)<p.a.distance(s.a)+p.b.distance(s.b))s=s.reversed()
                if(p!=null && s.length<p.length*0.72) {
                    streak[i]=0
                    s.copy(confidence=0.35,occluded=true)
                } else {
                streak[i]++
                s.copy(confidence=if(ambiguous)min(0.4,s.confidence) else if(streak[i]<3)min(0.5,s.confidence) else s.confidence)
                }
            }
        }
        last=selected.mapIndexed {i,s->if(s!=null && !ambiguous && !s.occluded){lastAt[i]=t;s}else if(s?.occluded==true)prior[i]?.copy(occluded=true) else prior[i]}
        return selected
    }
}
