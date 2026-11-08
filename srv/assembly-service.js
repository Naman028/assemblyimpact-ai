import cds from '@sap/cds';

const fields = new Set(['ID', 'assemblyCode', 'plant', 'description', 'version',
  'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy']);
const systemFields = ['version', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'];

// Requiredness, format, lengths and row authorization remain CAP responsibilities.
export default class AssemblyCatalog extends cds.ApplicationService {
  async handle(req) {
    if (req.target?.name !== 'AssemblyCatalog.Assemblies') return super.handle(req);
    if (!req.user.is('authenticated-user')) req.reject(401);
    if (!req.user.is('AssemblyViewer') && !req.user.is('AssemblyMaintainer')) req.reject(403);
    if (req.event !== 'READ' && !req.user.is('AssemblyMaintainer')) req.reject(403);
    const plants = req.user.attr.plants;
    if (!Array.isArray(plants) || !plants.length || plants.some(p =>
      typeof p !== 'string' || !p.trim() || p.length > 4 || p.includes('*'))) req.reject(403);

    const method = req._.req?.method ?? req.http?.req.method;
    if (!['READ', 'CREATE', 'UPDATE'].includes(req.event) ||
        (req.event === 'UPDATE' && method !== 'PATCH')) req.reject(405);
    if (req.event === 'CREATE' || req.event === 'UPDATE') {
      const data = req.data;
      for (const name of Object.keys(data)) {
        if (!fields.has(name)) req.reject(400, 'UNKNOWN_PROPERTY', name);
      }
      if (req.event === 'CREATE') {
        // Validate the scope attribute natively before comparing it with memberships.
        const errors = cds.validate(data.plant, req.target.elements.plant, { insert: true });
        if (errors?.length) req.reject(400, errors[0].code, 'plant');
        if (!plants.includes(data.plant)) req.reject(403);
        data.ID = cds.utils.uuid();
      } else {
        // CAP merges the URL ID into data; it cannot change the persisted key.
        if (['plant', 'assemblyCode'].some(name => Object.hasOwn(data, name))) {
          req.reject(400, 'IMMUTABLE_PROPERTY');
        }
        if (!Object.hasOwn(data, 'description')) req.reject(400, 'DESCRIPTION_REQUIRED');
        const token = req.headers['if-match'];
        if (!token) req.reject(428);
        if (!/^(?:W\/)?"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"$/.test(token)) {
          req.reject(400, 'INVALID_ETAG');
        }
      }
      for (const name of systemFields) delete data[name];
    }
    try {
      return await super.handle(req);
    } catch (error) {
      // Do not distinguish a hidden row from a missing conditional-update target.
      if (req.event === 'UPDATE' && [403, 404].includes(Number(error.status ?? error.code))) {
        req.reject(412);
      }
      // CAP's generic duplicate response is 400; map only this business constraint.
      if (error.message?.includes('assemblyimpact_Assemblies.assemblyCode, assemblyimpact_Assemblies.plant')) {
        req.reject({ status: 409, code: 'ASSEMBLY_ALREADY_EXISTS',
          message: 'An assembly with this code and plant already exists.', target: 'assemblyCode' });
      }
      throw error;
    }
  }
}
