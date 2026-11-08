using { assemblyimpact } from '../db/schema';

@path: 'assembly-catalog'
@requires: 'authenticated-user'
service AssemblyCatalog {
    @restrict: [
        { grant: 'READ', to: ['AssemblyViewer', 'AssemblyMaintainer'], where: 'plant = $user.plants' },
        { grant: ['CREATE', 'UPDATE'], to: 'AssemblyMaintainer', where: 'plant = $user.plants' }
    ]
    @Capabilities.DeleteRestrictions.Deletable: false
    entity Assemblies as projection on assemblyimpact.Assemblies {
        key ID,
        @mandatory @assert.format: '^[\s\S]*\S[\s\S]*$'
        assemblyCode,
        @mandatory @assert.format: '^[\s\S]*\S[\s\S]*$'
        plant,
        @mandatory @assert.format: '^[\s\S]*\S[\s\S]*$'
        description,
        @odata.etag
        version,
        createdAt, createdBy, modifiedAt, modifiedBy
    };
}
