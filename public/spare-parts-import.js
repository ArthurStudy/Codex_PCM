/* Importação de Spare Parts a partir do modelo Excel do PCM. */
globalThis.PCMSparePartsImport = (() => {
  const columns=['Máquina*','Descrição*','Código do fabricante','Fabricante','Código SAP*','Quantidade*'];
  const machineLabel=machine=>`${machine.tag} · ${machine.name}`;

  function template(state){
    const machines=state.assets.map(machineLabel);
    if(!machines.length)throw new Error('Cadastre pelo menos uma máquina antes de baixar o modelo.');
    const content=PCMExcel.build([columns],{sheetName:'Spare parts',validations:{0:machines}});
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    link.href=url;link.download='PCM-modelo-importacao-spare-parts.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function validate(rows,state){
    const header=rows.shift()?.map(value=>String(value||'').trim());
    if(!header||columns.some((name,index)=>header[index]!==name))throw new Error('As colunas não correspondem ao modelo de Spare Parts. Baixe um novo modelo e mantenha a primeira linha sem alterações.');
    const machines=new Map(state.assets.map(machine=>[machineLabel(machine).toLocaleLowerCase(),machine]));
    const existing=new Set((state.spare_parts||[]).map(part=>`${part.asset_id}|${String(part.sap_code).trim().toLocaleUpperCase()}`));
    const imported=new Set(),parts=[],issues=[];
    rows.forEach((row,index)=>{
      if(!row.some(value=>String(value??'').trim()))return;
      const line=index+2,cell=position=>String(row[position]??'').trim();
      const [machineName,description,manufacturer_code,manufacturer,inputSap,inputQuantity]=columns.map((_,position)=>cell(position));
      const machine=machines.get(machineName.toLocaleLowerCase()),sap_code=inputSap.toLocaleUpperCase(),quantity=Number(inputQuantity);
      const key=`${machine?.id||''}|${sap_code}`,fail=message=>issues.push(`Linha ${line}: ${message}`);
      if(!machine)fail(`máquina "${machineName||'vazia'}" não encontrada. Escolha uma opção da lista suspensa.`);
      if(!description)fail('preencha Descrição.');
      if(!sap_code)fail('preencha Código SAP.');
      if(!Number.isSafeInteger(quantity)||quantity<1)fail('Quantidade deve ser um número inteiro maior que zero.');
      if(machine&&sap_code&&existing.has(key))fail(`o código SAP ${sap_code} já está cadastrado nesta máquina.`);
      if(machine&&sap_code&&imported.has(key))fail(`o código SAP ${sap_code} está repetido para esta máquina no arquivo.`);
      imported.add(key);
      parts.push({asset_id:machine?.id||'',description,manufacturer_code,manufacturer,sap_code,quantity});
    });
    if(issues.length)throw new Error(issues.slice(0,12).join('\n')+(issues.length>12?`\nE mais ${issues.length-12} erro(s).`:''));
    if(!parts.length)throw new Error('Não há componentes preenchidos para importar.');
    if(parts.length>500)throw new Error('Importe no máximo 500 componentes por arquivo.');
    return parts;
  }

  return {columns,machineLabel,template,validate,read:file=>PCMOrderImport.read(file)};
})();
