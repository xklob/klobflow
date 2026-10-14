let database;
function db(){return database ||= new Promise((resolve,reject)=>{
  const request=indexedDB.open("klobflow-practice",1);
  request.onupgradeneeded=()=>request.result.createObjectStore("sessions",{keyPath:"id"});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function operation(mode,action){
  const database=await db();return new Promise((resolve,reject)=>{
    const transaction=database.transaction("sessions",mode),request=action(transaction.objectStore("sessions"));let result;
    request.onsuccess=()=>{result=request.result;};
    transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error || Error("Local session storage was interrupted"));
  });
}
export const saveSession=session=>operation("readwrite",store=>store.put(session));
export const getSession=id=>operation("readonly",store=>store.get(id));
export const listSessions=async()=> (await operation("readonly",store=>store.getAll())).sort((a,b)=>b.createdAt-a.createdAt);
export const deleteSession=id=>operation("readwrite",store=>store.delete(id));
