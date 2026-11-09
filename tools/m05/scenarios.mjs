// M05: six additional SYNTHETIC engineering-change scenarios (fictional NovaMotion Manufacturing).
// Declarative source for tools/m05/build-scenarios.mjs, which writes test/fixtures/m05/<dataset>/*.csv.
// No impact results are stored here: figures are produced only by EngineeringReview.runImpact.
// Reference date 2026-11-08. Revision A valid until 2026-11-30, revision B from 2026-12-01.

const scenario = s => ({ plant: '1000', productionQuantity: 50, snapshotAt: '2026-11-07T08:00:00Z', ...s });

export const SCENARIOS = [
  scenario({
    dataset: 'DS-M05-01', assemblyCode: 'GEAR-210', description: 'Two-stage gearbox',
    caseNumber: 'EC-000512', title: 'Sealed bearing with double shaft seal and new shim on GEAR-210', owner: 'Engineering Reviewer 2',
    productionQuantity: 40,
    purpose: 'Multi-component revision: replacement, quantity change, new component, shortage, outdated instruction',
    materials: [
      ['BRG-6204', 'Ball bearing 6204 (open)', 'PC', 6.40, 300], ['BRG-6204-2RS', 'Ball bearing 6204-2RS (sealed)', 'PC', 8.10, 30],
      ['SEAL-25', 'Shaft seal 25x42x7', 'PC', 1.90, 200], ['SHIM-05', 'Shim 0.5 mm', 'PC', 0.35, 500],
      ['HSG-210', 'Gearbox housing', 'PC', 64.00, 60], ['SCR-M6', 'Screw M6x16', 'PC', 0.12, 2000],
    ],
    a: [['0010', 'HSG-210', 1], ['0020', 'BRG-6204', 2], ['0030', 'SEAL-25', 1], ['0040', 'SCR-M6', 8]],
    b: [['0010', 'HSG-210', 1], ['0020', 'BRG-6204-2RS', 2], ['0030', 'SEAL-25', 2], ['0040', 'SCR-M6', 8], ['0050', 'SHIM-05', 2]],
    instructions: [
      ['WI-GEAR-210-ASM', 4, 'Assemble gearbox', '', 'RELEASED', '2026-03-01',
        [['0010', 'HSG-210', 1, 'Prepare housing'], ['0020', 'BRG-6204', 2, 'Press in bearings 6204'], ['0030', 'SEAL-25', 1, 'Fit shaft seal']]],
    ],
  }),
  scenario({
    dataset: 'DS-M05-02', assemblyCode: 'VALV-320', description: 'Hydraulic valve block',
    caseNumber: 'EC-000538', title: 'Remove obsolete O-ring from VALV-320', owner: 'Engineering Reviewer 1',
    productionQuantity: 120,
    purpose: 'Obsolete component removed, cost decrease, sufficient stock, instruction still references removed part',
    materials: [
      ['BLK-320', 'Valve block body', 'PC', 48.00, 400], ['ORING-12', 'O-ring 12x2 NBR', 'PC', 0.45, 1000],
      ['PLUG-G14', 'Plug G1/4', 'PC', 1.10, 900], ['SPOOL-32', 'Valve spool', 'PC', 12.50, 300],
    ],
    a: [['0010', 'BLK-320', 1], ['0020', 'SPOOL-32', 1], ['0030', 'ORING-12', 4], ['0040', 'PLUG-G14', 3]],
    b: [['0010', 'BLK-320', 1], ['0020', 'SPOOL-32', 1], ['0040', 'PLUG-G14', 3]],
    instructions: [
      ['WI-VALV-320-ASM', 2, 'Assemble valve block', '', 'RELEASED', '2026-02-01',
        [['0010', 'SPOOL-32', 1, 'Insert spool'], ['0020', 'ORING-12', 4, 'Fit four O-rings'], ['0030', 'PLUG-G14', 3, 'Close ports with plugs']]],
    ],
  }),
  scenario({
    dataset: 'DS-M05-03', assemblyCode: 'CTRL-400', description: 'Motor controller board',
    caseNumber: 'EC-000561', title: 'Automotive-grade capacitor and extra connector on CTRL-400', owner: 'Engineering Reviewer 2',
    productionQuantity: 200,
    purpose: 'Material cost increase through replacement, quantity increase, inventory shortage of the new part (zero stock)',
    materials: [
      ['PCB-400', 'Controller PCB (bare)', 'PC', 9.80, 800], ['CAP-470U', 'Capacitor 470 uF 35 V', 'PC', 0.62, 1500],
      ['CAP-470U-AQ', 'Capacitor 470 uF 35 V AEC-Q200', 'PC', 1.48, 0], ['CONN-6P', 'Connector 6-pin', 'PC', 0.95, 500],
      ['MCU-32', 'Microcontroller 32-bit', 'PC', 4.70, 400],
    ],
    a: [['0010', 'PCB-400', 1], ['0020', 'MCU-32', 1], ['0030', 'CAP-470U', 4], ['0040', 'CONN-6P', 1]],
    b: [['0010', 'PCB-400', 1], ['0020', 'MCU-32', 1], ['0030', 'CAP-470U-AQ', 4], ['0040', 'CONN-6P', 2]],
    instructions: [
      ['WI-CTRL-400-SMT', 3, 'SMT placement program', 'B', 'RELEASED', '2026-12-01',
        [['0010', 'MCU-32', 1, 'Place MCU'], ['0020', 'CAP-470U-AQ', 4, 'Place capacitors (AEC-Q200)']]],
      ['WI-CTRL-400-THT', 1, 'Connector soldering', '', 'RELEASED', '2026-04-01',
        [['0010', 'CONN-6P', 1, 'Solder one connector']]],
    ],
  }),
  scenario({
    dataset: 'DS-M05-04', assemblyCode: 'FRAME-500', description: 'Welded machine frame',
    caseNumber: 'EC-000587', title: 'Stiffen FRAME-500 with reinforcement plate and more bolts', owner: 'Engineering Reviewer 1',
    productionQuantity: 25,
    purpose: 'Quantity change and new component with sufficient stock; instructions already updated for revision B',
    materials: [
      ['BEAM-80', 'Steel beam 80x80', 'PC', 22.00, 300], ['BOLT-M10', 'Bolt M10x30 8.8', 'PC', 0.28, 5000],
      ['PLATE-R5', 'Reinforcement plate 5 mm', 'PC', 7.40, 120], ['FOOT-50', 'Levelling foot', 'PC', 3.20, 400],
    ],
    a: [['0010', 'BEAM-80', 4], ['0020', 'BOLT-M10', 8], ['0030', 'FOOT-50', 4]],
    b: [['0010', 'BEAM-80', 4], ['0020', 'BOLT-M10', 12], ['0030', 'FOOT-50', 4], ['0040', 'PLATE-R5', 2]],
    instructions: [
      ['WI-FRAME-500-ASM', 5, 'Assemble frame', 'A', 'SUPERSEDED', '2026-01-01',
        [['0010', 'BEAM-80', 4, 'Align beams'], ['0020', 'BOLT-M10', 8, 'Fit eight bolts']]],
      ['WI-FRAME-500-ASM', 6, 'Assemble frame', 'B', 'RELEASED', '2026-12-01',
        [['0010', 'BEAM-80', 4, 'Align beams'], ['0020', 'BOLT-M10', 12, 'Fit twelve bolts'], ['0030', 'PLATE-R5', 2, 'Weld reinforcement plates']]],
    ],
  }),
  scenario({
    dataset: 'DS-M05-05', assemblyCode: 'HVAC-610', description: 'Rooftop HVAC unit', plant: '2000',
    caseNumber: 'EC-200610', title: 'Inverter compressor on HVAC-610 (plant 2000)', owner: 'Engineering Reviewer 3',
    productionQuantity: 10, snapshotAt: '2026-10-01T08:00:00Z',
    purpose: 'Component replacement in plant 2000 with an old stock snapshot (stale-stock warning when calculated)',
    materials: [
      ['COMP-F10', 'Compressor (fixed speed)', 'PC', 410.00, 25], ['COMP-I10', 'Compressor (inverter)', 'PC', 585.00, 12],
      ['COIL-61', 'Condenser coil', 'PC', 132.00, 30], ['CTRL-HV1', 'HVAC control unit', 'PC', 88.00, 20],
    ],
    a: [['0010', 'COIL-61', 1], ['0020', 'COMP-F10', 1], ['0030', 'CTRL-HV1', 1]],
    b: [['0010', 'COIL-61', 1], ['0020', 'COMP-I10', 1], ['0030', 'CTRL-HV1', 1]],
    instructions: [
      ['WI-HVAC-610-ASM', 2, 'Assemble HVAC unit', '', 'RELEASED', '2026-05-01',
        [['0010', 'COIL-61', 1, 'Mount coil'], ['0020', 'COMP-F10', 1, 'Mount fixed-speed compressor']]],
    ],
  }),
  scenario({
    dataset: 'DS-M05-06', assemblyCode: 'DRIV-700', description: 'Conveyor drive unit',
    caseNumber: 'EC-000703', title: 'Add encoder to DRIV-700 (price not yet maintained)', owner: 'Engineering Reviewer 2',
    productionQuantity: 30,
    purpose: 'New component without a maintained price: the calculation is INCOMPLETE and approval is refused',
    materials: [
      ['MOT-07', 'Gear motor 0.75 kW', 'PC', 215.00, 60], ['CPL-20', 'Shaft coupling 20 mm', 'PC', 14.00, 90],
      ['ENC-1024', 'Incremental encoder 1024 ppr', 'PC', null, 40],
    ],
    a: [['0010', 'MOT-07', 1], ['0020', 'CPL-20', 1]],
    b: [['0010', 'MOT-07', 1], ['0020', 'CPL-20', 1], ['0030', 'ENC-1024', 1]],
    instructions: [
      ['WI-DRIV-700-ASM', 1, 'Assemble drive unit', '', 'RELEASED', '2026-01-15',
        [['0010', 'MOT-07', 1, 'Mount motor'], ['0020', 'CPL-20', 1, 'Fit coupling']]],
    ],
  }),
];
