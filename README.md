# Órdenes Ineco

App simple en React para cargar pacientes, generar órdenes e imprimirlas en PDF.

## Cómo usar

```bash
npm install
npm run dev
```

## Datos

La fuente de verdad del deploy es `src/data/db.json` (pacientes, médicos y médico por defecto). Viaja con el build y se carga sola.

Para regenerar ese JSON desde los seeds:

```bash
npm run generate-db
```

## Funciones

- Tabla de pacientes y médicos, vínculo paciente↔médico
- Agregar / editar / eliminar
- Imprimir una o todas (PDF en pestaña nueva)
- Firma del médico en el PDF
