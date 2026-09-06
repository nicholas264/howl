import { neonConfig } from '@neondatabase/serverless';

// Exercise unchanged Neon-backed handlers against isolated PostgreSQL, including
// the HTTP driver's real parameter encoding and result decoding.
export function useTestDatabase(db, beforeQuery = () => {}) {
  const previous = neonConfig.fetchFunction;
  neonConfig.fetchFunction = async (_url,init) => {
    const request = JSON.parse(init.body);
    try {
      await beforeQuery(request.query,request.params);
      const result = await db.query(request.query,request.params);
      const fields = result.fields || [];
      const encode = (value,field) => {
        if (value == null) return null;
        if ([114,3802].includes(field.dataTypeID)) return JSON.stringify(value);
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'boolean') return value ? 't' : 'f';
        if (Array.isArray(value)) return `{${value.map(item=>item == null ? 'NULL' : '"'+String(item).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')}}`;
        return String(value);
      };
      return Response.json({fields,rows:result.rows.map(row=>fields.map(field=>encode(row[field.name],field))),rowCount:result.affectedRows || result.rows.length});
    } catch(error) {return Response.json({message:error.message,code:error.code || 'XX000'},{status:400});}
  };
  return () => {neonConfig.fetchFunction=previous;};
}
