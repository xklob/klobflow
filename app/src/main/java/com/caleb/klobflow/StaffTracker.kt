package com.caleb.klobflow

import kotlin.math.*

/** Luminous-region detector with a Hough fallback for unlit props. No fixed LED hue. */
class StaffDetector {
    private val angles=180
    private val cosines=DoubleArray(angles){cos(it*PI/angles)}
    private val sines=DoubleArray(angles){sin(it*PI/angles)}
    fun detect(pixels: IntArray,w: Int,h: Int,c: Config,hints:List<Segment> = emptyList()): List<Segment> {
        require(pixels.size==w*h && w>0 && h>0)
        val argb=if(c.led)filterStaffColors(pixels,w,h,c.staffColors)else pixels
        if(c.led){
            val lights=ledRegions(argb,w,h,c,hints)
            val recovered=if(lights.second && lights.first.all {s->hints.isEmpty() || hints.any {s.length>it.length*.85}})lights.first
                else motionCandidates(argb,w,h,c,hints,lights.first)
            if(recovered.isNotEmpty()||c.staffCount==1||!lights.third)return recovered.map {s->if(s.blurred)glowBodyEndpoints(argb,w,h,s) ?: s else s}
        }
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
        if(pixels.size<12)return if(c.led)motionCandidates(argb,w,h,c,hints,emptyList())else emptyList()
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
        return (if(c.led)motionCandidates(argb,w,h,c,hints,result)else result).sortedByDescending {it.confidence*sqrt(it.length)}.take(8)
    }

    /** Pair luminous halves across a grip; do not confuse room edges with an entire staff. */
    private fun ledRegions(argb:IntArray,w:Int,h:Int,c:Config,hints:List<Segment>):Triple<List<Segment>,Boolean,Boolean> {
        val unit=min(w,h).toDouble();val mask=BooleanArray(w*h);val weights=DoubleArray(w*h);val queue=IntArray(w*h)
        fun high(p:Int)=max(p ushr 16 and 255,max(p ushr 8 and 255,p and 255))
        fun low(p:Int)=min(p ushr 16 and 255,min(p ushr 8 and 255,p and 255))
        for(i in mask.indices){val p=argb[i];val hi=high(p);if(hi>=c.threshold&&(hi-low(p)>35||hi>=min(250,c.threshold+35))){mask[i]=true;weights[i]=hi.toDouble()}}
        data class Region(val points:List<Int>,val color:Double,val ratio:Double,val clipped:Boolean,val mid:P,val s:Segment)
        fun describe(points:List<Int>):Region {
            var mass=0.0;var mx=0.0;var my=0.0;var color=0
            for(i in points){val v=weights[i];mass+=v;mx+=(i%w)*v;my+=(i/w)*v;if(high(argb[i])-low(argb[i])>35)color++};mx/=mass;my/=mass
            var xx=0.0;var xy=0.0;var yy=0.0
            for(i in points){val x=i%w-mx;val y=i/w-my;val v=weights[i];xx+=x*x*v;xy+=x*y*v;yy+=y*y*v};xx/=mass;xy/=mass;yy/=mass
            val theta=.5*atan2(2*xy,xx-yy);val dx=cos(theta);val dy=sin(theta);val spread=hypot(xx-yy,2*xy);val major=(xx+yy+spread)/2;val minor=max(0.0,(xx+yy-spread)/2)
            var low=Double.POSITIVE_INFINITY;var high=Double.NEGATIVE_INFINITY
            for(i in points){val a=(i%w-mx)*dx+(i/w-my)*dy;low=min(low,a);high=max(high,a)}
            val ratio=minor/max(1.0,major);val clipped=points.any {it%w<2||it%w>=w-2||it/w<2||it/w>=h-2};val blurred=ratio>.008||clipped
            return Region(points,color.toDouble()/points.size,ratio,clipped,P(mx/unit,my/unit),Segment(P((mx+dx*low)/unit,(my+dy*low)/unit),P((mx+dx*high)/unit,(my+dy*high)/unit),if(blurred).5 else .8,blurred=blurred))
        }
        val regions=ArrayList<Region>()
        for(i in mask.indices)if(mask[i]){
            var head=0;var tail=1;queue[0]=i;mask[i]=false;val points=ArrayList<Int>()
            while(head<tail){val at=queue[head++];points.add(at);val x=at%w;val y=at/w
                for(dy in -1..1)for(dx in -1..1){val xx=x+dx;val yy=y+dy;val k=yy*w+xx;if(xx in 0 until w&&yy in 0 until h&&mask[k]){mask[k]=false;queue[tail++]=k}}
            }
            if(points.size>=8&&points.size<w*h*.12)regions.add(describe(points))
        }
        regions.sortByDescending {it.points.size};while(regions.size>24)regions.removeAt(24)
        data class Candidate(val s:Segment,val points:List<Int>,val complete:Boolean,val rank:Double)
        val candidates=ArrayList<Candidate>()
        for(i in regions.indices)for(j in i+1 until regions.size){
            val a=regions[i];val b=regions[j];val axis=atan2(b.mid.y-a.mid.y,b.mid.x-a.mid.x)
            if(min(a.points.size,b.points.size)<max(a.points.size,b.points.size)*.12)continue
            if((a.ratio<.12&&angleDifference(a.s.angle,axis)>.45)||(b.ratio<.12&&angleDifference(b.s.angle,axis)>.45))continue
            val merged=describe(a.points+b.points);val s=merged.s;val len=s.length;val gap=a.mid.distance(b.mid)-(a.s.length+b.s.length)/2
            if(len<c.minLength||len>1.65||merged.ratio>.16||gap>len*.48)continue
            if(min(a.color,b.color)<.18&&(a.ratio>.008||b.ratio>.008||a.clipped||b.clipped)&&hints.none {s.center.distance(it.center)<.15&&len>it.length*.72&&len<it.length*1.35})continue
            candidates.add(Candidate(s,merged.points,true,sqrt(a.points.size.toDouble()*b.points.size)*sqrt(len)/(1+merged.ratio*4)))
        }
        for(r in regions)if(r.s.length>=c.minLength&&((r.ratio<.008&&!r.clipped)||(r.ratio<.12&&r.color>.35))){
            candidates.add(Candidate(r.s,r.points,r.s.blurred,r.points.size*.5*sqrt(r.s.length)/(1+r.ratio*4)))
        }
        candidates.sortByDescending {it.rank};val selected=ArrayList<Segment>();val used=HashSet<Int>();var complete=false
        for(candidate in candidates){if(candidate.points.any {it in used})continue;selected.add(candidate.s);complete=complete||candidate.complete;used.addAll(candidate.points);if(selected.size==c.staffCount)break}
        return Triple(selected,complete,regions.any {it.ratio>.12&&it.color>.5&&it.points.size>c.minLength*unit*6})
    }

    /** Fit a dim exposure sweep only near a recently observed staff. Broad blur is not precision. */
    private fun motionCandidates(argb:IntArray,w:Int,h:Int,c:Config,hints:List<Segment>,sharp:List<Segment>):List<Segment> {
        if(hints.isEmpty())return sharp
        val short=min(w,h).toDouble();val histogram=IntArray(256);var samples=0
        for(y in 1 until h-1 step 2)for(x in 1 until w-1 step 2)if(hints.any {P(x/short,y/short).distance(it.center)<it.length*.7+.12}){
            val p=argb[y*w+x];histogram[max(p ushr 16 and 255,max(p ushr 8 and 255,p and 255))]++;samples++
        }
        var median=0;var total=histogram[0];while(median<255&&total<samples/2.0){median++;total+=histogram[median]}
        val floor=max(max(24.0,c.threshold*.14),median+6.0)
        val mask=BooleanArray(w*h);val weights=DoubleArray(w*h);val queue=IntArray(w*h)
        for(y in 1 until h-1)for(x in 1 until w-1){
            val i=y*w+x;val p=argb[i];val hi=max(p ushr 16 and 255,max(p ushr 8 and 255,p and 255));val lo=min(p ushr 16 and 255,min(p ushr 8 and 255,p and 255))
            if(hi<floor || !(hi-lo>max(10.0,hi*.14) || hi>max(50.0,c.threshold*.3)))continue
            if(hints.none {P(x/short,y/short).distance(it.center)<it.length*.7+.12})continue
            mask[i]=true;weights[i]=max(1.0,hi-(if(hi-lo>12)lo.toDouble()else floor))
        }
        data class Region(val points:List<Int>,val ratio:Double,val s:Segment)
        fun describe(points:List<Int>):Region {
            var mass=0.0;var mx=0.0;var my=0.0
            for(i in points){val v=weights[i];mass+=v;mx+=(i%w)*v;my+=(i/w)*v};mx/=mass;my/=mass
            var xx=0.0;var xy=0.0;var yy=0.0
            for(i in points){val dx=i%w-mx;val dy=i/w-my;val v=weights[i];xx+=dx*dx*v;xy+=dx*dy*v;yy+=dy*dy*v};xx/=mass;xy/=mass;yy/=mass
            val theta=.5*atan2(2*xy,xx-yy);val dx=cos(theta);val dy=sin(theta);val spread=hypot(xx-yy,2*xy)
            val major=(xx+yy+spread)/2;val minor=max(0.0,(xx+yy-spread)/2)
            var low=Double.POSITIVE_INFINITY;var high=Double.NEGATIVE_INFINITY
            for(i in points){val along=(i%w-mx)*dx+(i/w-my)*dy;low=min(low,along);high=max(high,along)}
            val ratio=minor/max(1.0,major);val blurred=ratio>.006
            return Region(points,ratio,Segment(P((mx+dx*low)/short,(my+dy*low)/short),P((mx+dx*high)/short,(my+dy*high)/short),if(blurred).5 else .7,blurred=blurred))
        }
        val components=ArrayList<Region>()
        for(i in mask.indices)if(mask[i]){
            var head=0;var tail=1;queue[0]=i;mask[i]=false;val points=ArrayList<Int>()
            while(head<tail){val at=queue[head++];points.add(at);val x=at%w;val y=at/w
                for(dy in -1..1)for(dx in -1..1){val xx=x+dx;val yy=y+dy;val next=yy*w+xx
                    if(xx in 0 until w && yy in 0 until h && mask[next]){mask[next]=false;queue[tail++]=next}
                }
            }
            if(points.size>=12 && points.size<w*h*.18)components.add(describe(points))
        }
        components.sortByDescending {it.points.size};while(components.size>24)components.removeAt(24)
        var i=0;while(i<components.size){var j=i+1;while(j<components.size){
            val a=components[i];val b=components[j];val d=b.s.center-a.s.center
            fun owner(s:Segment)=hints.indices.minBy {s.center.distance(hints[it].center)}
            if(owner(a.s)!=owner(b.s)){j++;continue}
            val axis=atan2(d.y,d.x)
            if((a.ratio<.12&&angleDifference(a.s.angle,axis)>.45)||(b.ratio<.12&&angleDifference(b.s.angle,axis)>.45)){j++;continue}
            val joined=describe(a.points+b.points)
            if(joined.ratio>.14||a.s.center.distance(b.s.center)-(a.s.length+b.s.length)/2>joined.s.length*.48||hints.none {joined.s.length<it.length*1.2}){j++;continue}
            components[i]=joined;components.removeAt(j)
        };i++}
        var result=sharp.toList()
        for(component in components){var s=component.s;val len=s.length
            if(component.ratio>.14 || len<c.minLength || hints.none {len>=it.length*.72 && len<=it.length*1.2 && s.center.distance(it.center)<.12+it.length*.25 && angleDifference(s.angle,it.angle)<1.4})continue
            if(s.blurred){val reference=hints.minBy {s.center.distance(it.center)+angleDifference(s.angle,it.angle)*.1};val unit=P(cos(s.angle),sin(s.angle));val d=unit*(reference.length/2);var mid=s.center
                if(len<reference.length*.9){val delta=mid-reference.center;mid-=unit*(delta.x*unit.x+delta.y*unit.y)}
                s=s.copy(a=mid-d,b=mid+d)
            }
            fun nearby(old:Segment)=old.center.distance(s.center)<.07+len*.12 && old.length>len*.45 && old.length<len*1.3 && angleDifference(old.angle,s.angle)<max(.2,3*sqrt(component.ratio))
            if(component.ratio<.003 && result.any {nearby(it)&&it.length>len*.85})continue
            result=result.filterNot {nearby(it)}+s
        }
        return result
    }
}

class StaffTracker {
    private var last=listOf<Segment?>(null,null)
    private var lastAt=longArrayOf(0,0)
    private var streak=intArrayOf(0,0)
    private var confirmedAt=longArrayOf(-1000000,-1000000)
    private var motion=Array(2){DoubleArray(3)}
    fun reset(){last=listOf(null,null);lastAt=longArrayOf(0,0);streak=intArrayOf(0,0);confirmedAt=longArrayOf(-1000000,-1000000);motion=Array(2){DoubleArray(3)}}
    fun seed(staffs: List<Segment>,t:Long){require(staffs.size in 1..2);reset();last=staffs+List(2-staffs.size){null};lastAt=longArrayOf(t,t)}
    private fun predicted(i:Int,t:Long):Segment? {
        val s=last[i] ?: return null;val dt=((t-lastAt[i])/1000.0).coerceIn(0.0,.15);val v=motion[i]
        val center=s.center+P(v[0]*dt,v[1]*dt);val a=s.angle+v[2]*dt;val d=P(cos(a),sin(a))*(s.length/2)
        return s.copy(a=center-d,b=center+d)
    }
    fun hints(t:Long,count:Int=2)=last.mapIndexedNotNull {i,s->if(i<count && s!=null && t-lastAt[i]<250)predicted(i,t)else null}
    fun update(candidates: List<Segment>,t:Long,count:Int=2): List<Segment?> {
        val prior=last.mapIndexed {i,s->s?.takeIf {i<count}?.takeIf {t-lastAt[i]<(if(it.blurred)350 else 1500)}}
        fun cost(i:Int,s:Segment):Double {
            val p=prior[i] ?: return 0.22-s.confidence*0.1
            val predicted=predicted(i,t)!!
            val delta=(t-lastAt[i]).coerceAtLeast(1)/1000.0
            val center=predicted.center.distance(s.center)
            val angle=angleDifference(predicted.angle,s.angle)
            if(center>0.16+delta*1.8 || angle>0.3+delta*20 || s.length/p.length !in 0.25..1.4)return 10.0
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
            if(index<0){confirmedAt[i]=-1000000;val p=prior[i];val established=streak[i]>=3;streak[i]=0
                if(p!=null && (established || p.occluded || p.blurred))p.copy(confidence=0.3,occluded=true) else null
            }else {
                var s=candidates[index];val p=prior[i]
                val predicted=if(p!=null)predicted(i,t)else null
                if(predicted!=null && predicted.a.distance(s.b)+predicted.b.distance(s.a)<predicted.a.distance(s.a)+predicted.b.distance(s.b))s=s.reversed()
                if(p!=null && s.length<p.length*0.72) {
                    streak[i]=0;confirmedAt[i]=-1000000
                    s.copy(confidence=0.35,occluded=true)
                } else {
                if(ambiguous)confirmedAt[i]=-1000000
                if(s.blurred)streak[i]=0 else streak[i]++
                // A rejected exposure does not erase a recently confirmed identity. Only a
                // current clear associated observation can resume; predicted/blurred poses cannot.
                val confirmed=!ambiguous&&!s.blurred&&(streak[i]>=3||(p!=null&&!p.occluded&&t-confirmedAt[i] in 0..250))
                if(confirmed)confirmedAt[i]=t
                s.copy(confidence=if(ambiguous)min(0.4,s.confidence) else if(confirmed)s.confidence else min(0.5,s.confidence))
                }
            }
        }
        last=selected.mapIndexed {i,s->if(s!=null && !ambiguous && !s.occluded){
            val p=prior[i];val dt=(t-lastAt[i])/1000.0
            if(p!=null && dt in .008.. .2){
                val delta=s.center-p.center;val da=.5*atan2(sin(2*(s.angle-p.angle)),cos(2*(s.angle-p.angle)))
                val v=doubleArrayOf((delta.x/dt).coerceIn(-3.0,3.0),(delta.y/dt).coerceIn(-3.0,3.0),(da/dt).coerceIn(-30.0,30.0))
                for(j in 0..2)motion[i][j]=motion[i][j]*.35+v[j]*.65
            }else motion[i]=DoubleArray(3)
            lastAt[i]=t;s
        }else if(s?.occluded==true)prior[i]?.copy(occluded=true) else prior[i]}
        return selected
    }
}
