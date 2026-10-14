package com.caleb.klobflow

import kotlin.math.abs

/** Four-point plane mapping. Input and output coordinates use their own isotropic units. */
class Homography private constructor(private val h:DoubleArray) {
    fun map(p:P):P? {
        val d=h[6]*p.x+h[7]*p.y+1
        if(!d.isFinite() || abs(d)<1e-8)return null
        return P((h[0]*p.x+h[1]*p.y+h[2])/d,(h[3]*p.x+h[4]*p.y+h[5])/d)
            .takeIf {it.x.isFinite() && it.y.isFinite()}
    }
    companion object {
        fun between(from:List<P>,to:List<P>):Homography {
            require(from.size==4 && to.size==4)
            val rows=Array(8){DoubleArray(9)}
            from.zip(to).forEachIndexed {i,(p,q)->
                rows[2*i]=doubleArrayOf(p.x,p.y,1.0,0.0,0.0,0.0,-q.x*p.x,-q.x*p.y,q.x)
                rows[2*i+1]=doubleArrayOf(0.0,0.0,0.0,p.x,p.y,1.0,-q.y*p.x,-q.y*p.y,q.y)
            }
            for(col in 0..7){
                val pivot=(col..7).maxBy {abs(rows[it][col])}
                require(abs(rows[pivot][col])>1e-9){"Calibration corners are too close or aligned"}
                val temp=rows[col];rows[col]=rows[pivot];rows[pivot]=temp
                val divisor=rows[col][col]
                for(j in col..8)rows[col][j]/=divisor
                for(i in 0..7)if(i!=col){val factor=rows[i][col];for(j in col..8)rows[i][j]-=factor*rows[col][j]}
            }
            return Homography(DoubleArray(8){rows[it][8]})
        }
    }
}

fun validateCorners(points:List<P>) {
    if(points.isEmpty())return
    require(points.size==4 && points.all {it.x.isFinite() && it.y.isFinite() && it.x in 0.0..1.0 && it.y in 0.0..1.0}){"Choose four corners inside the image"}
    var area=0.0
    for(i in 0..3){
        val a=points[i];val b=points[(i+1)%4];val c=points[(i+2)%4]
        require((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>0.002 && a.distance(b)>0.04){"Tap top left, top right, bottom right, bottom left around a clear rectangle"}
        area+=a.x*b.y-a.y*b.x
    }
    require(area/2>=0.04){"Choose a larger practice plane"}
}
