/* Consolidação auditável de peças por código SAP. */
globalThis.PCMSpareParts = (() => {
  const normalizeSap = value => String(value ?? '').trim().toLocaleUpperCase('pt-BR');

  function catalog(parts = [], assets = []) {
    const machines = new Map(assets.map(machine => [String(machine.id), machine]));
    const groups = new Map();
    for (const part of parts) {
      const sapCode = normalizeSap(part.sap_code);
      if (!sapCode) continue;
      if (!groups.has(sapCode)) groups.set(sapCode, {
        sap_code:sapCode,
        description:part.description || '',
        manufacturer_code:part.manufacturer_code || '',
        manufacturer:part.manufacturer || '',
        total_quantity:0,
        usages:[]
      });
      const group = groups.get(sapCode), quantity = Number(part.quantity) || 0;
      group.total_quantity += quantity;
      group.usages.push({ ...part,quantity,machine:machines.get(String(part.asset_id)) || null });
    }
    return [...groups.values()].map(group => ({
      ...group,
      usages:group.usages.sort((a,b) => String(a.machine?.tag || '').localeCompare(String(b.machine?.tag || ''),'pt-BR'))
    })).sort((a,b) => a.sap_code.localeCompare(b.sap_code,'pt-BR'));
  }

  return { catalog,normalizeSap };
})();
