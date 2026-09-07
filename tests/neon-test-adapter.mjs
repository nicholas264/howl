import { neonConfig } from '@neondatabase/serverless';

// Exercise unchanged Neon-backed handlers against isolated PostgreSQL, including
// the HTTP driver's real parameter encoding and result decoding.
export function useTestDatabase(db, beforeQuery = () => {}, afterQuery = () => {}) {
  const previous = neonConfig.fetchFunction;
  neonConfig.fetchFunction = async (_url,init) => {
    const request = JSON.parse(init.body);
    try {
      const serialize = result => {
      const fields = result.fields || [];
      const encode = (value,field) => {
        if (value == null) return null;
        if ([114,3802].includes(field.dataTypeID)) return JSON.stringify(value);
        // PostgreSQL text timestamps use a space separator; the pg parser rejects
        // ISO's T separator. Preserve timestamptz UTC offset for the real decoder.
        if (value instanceof Date) return field.dataTypeID === 1082 ? value.toISOString().slice(0, 10) : value.toISOString().replace('T',' ').replace('Z','+00');
        if (typeof value === 'boolean') return value ? 't' : 'f';
        if (Array.isArray(value)) return `{${value.map(item=>item == null ? 'NULL' : '"'+String(item).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')}}`;
        return String(value);
      };
      return {fields,rows:result.rows.map(row=>fields.map(field=>encode(row[field.name],field))),rowCount:result.affectedRows || result.rows.length};
      };
      const execute=async(connection,query)=>{await beforeQuery(query.query,query.params);const result=await connection.query(query.query,query.params);await afterQuery(query.query,query.params);return serialize(result);};
      if(Array.isArray(request.queries)) {
        const isolation=new Headers(init.headers).get('Neon-Batch-Isolation-Level');
        const modes={ReadUncommitted:'READ UNCOMMITTED',ReadCommitted:'READ COMMITTED',RepeatableRead:'REPEATABLE READ',Serializable:'SERIALIZABLE'};
        const results=await db.transaction(async tx=>{
          if(isolation){if(!modes[isolation])throw new Error('Unsupported isolation');await tx.exec('SET TRANSACTION ISOLATION LEVEL '+modes[isolation]);}
          const rows=[];for(const query of request.queries)rows.push(await execute(tx,query));return rows;
        });
        return Response.json({results});
      }
      return Response.json(await execute(db,request));
    } catch(error) {return Response.json({message:error.message,code:error.code || 'XX000'},{status:400});}
  };
  return () => {neonConfig.fetchFunction=previous;};
}
