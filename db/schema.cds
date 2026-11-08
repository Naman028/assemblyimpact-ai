
namespace assemblyimpact;

using { cuid, managed } from '@sap/cds/common';

/**
 * Engineering assembly master record.
 * The technical UUID stays stable across business references.
 */
entity Assemblies : cuid, managed {
    assemblyCode : String(40) not null;
    plant        : String(4) not null;
    description  : String(160) not null;
}

// A business assembly code must be unique within its plant.
annotate Assemblies with
    @assert.unique.assemblyPerPlant: [assemblyCode, plant];
