# Comparación de modelos

Mismos mensajes y el mismo motor. No se escribió nada en las conversaciones de prueba.

Precios de lista por millón: Terra 2/12, Luna 5.6 0,20/1,20, Luna 6 0,10/0,50, 5.4 mini 0,75/4,50, 5.4 nano 0,20/1,25, 4.1 mini 0,40/1,60, 5 nano 0,05/0,40.
Si un modelo rechaza el razonamiento, la corrida lo reintenta con el ajuste mínimo que acepta. Terra y Luna de producción no cambian.

## Terra + Luna

Detecta: gpt-5.6-terra. Redacta: gpt-5.6-luna.

### Cobertura

Persona: ¿Atienden por Swiss Medical?

Para mirar: autorización y orden a turnos@ineco.ar, prestador 272152

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.



¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA. Sí, Swiss Medical requiere autorización de la obra social y orden médica, que se envían a turnos@ineco.ar. El prestador es 272152, Centro de Psicología Médica San Martín de Tours (Grupo INECO). ¿La consulta es para vos o para otra persona?

Tokens: entrada 7002 · salida 258 · US$ 0,0075 · ARS 11,57

### Cobertura OSDE

Persona: ¿Atienden por OSDE?

Para mirar: no está en Coberturas: no inventar que atienden; mail coberturas@ineco.org.ar

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.



¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA. La cobertura depende de la sede, la prestación y el plan. Podés consultar a coberturas@ineco.org.ar. ¿La consulta es para vos o para otra persona?

Tokens: entrada 7001 · salida 240 · US$ 0,0075 · ARS 11,64

### Cobertura PAMI

Persona: Tengo PAMI, ¿me cubren una consulta?

Para mirar: solo grupos de rehabilitación cognitiva

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.



¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA. PAMI solo tiene convenio para grupos de rehabilitación cognitiva; la cobertura de una consulta depende de la prestación. Podés consultar a coberturas@ineco.org.ar. Para orientarte, decime el nombre del paciente.

Tokens: entrada 6998 · salida 251 · US$ 0,0075 · ARS 11,69

**Total Terra + Luna:** US$ 0,0225 · ARS 34,90

## Luna 6

Detecta: gpt-6-luna. Redacta: gpt-6-luna.

### Cobertura

Persona: ¿Atienden por Swiss Medical?

Para mirar: autorización y orden a turnos@ineco.ar, prestador 272152

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.



¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. Para atenderte por Swiss Medical, necesitás autorización de la obra social y orden médica; se envían a turnos@ineco.ar. El prestador es 272152, Centro de Psicología Médica San Martín de Tours (Grupo INECO). ¿La consulta es para vos o para otra persona?

Tokens: entrada 6999 · salida 316 · US$ 0,0009 · ARS 1,33

### Cobertura OSDE

Persona: ¿Atienden por OSDE?

Para mirar: no está en Coberturas: no inventar que atienden; mail coberturas@ineco.org.ar

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.



¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. La cobertura depende de la sede, la prestación y el plan. Podés consultar en coberturas@ineco.org.ar. ¿La consulta es para vos o para otra persona?

Tokens: entrada 6999 · salida 315 · US$ 0,0009 · ARS 1,33

### Cobertura PAMI

Persona: Tengo PAMI, ¿me cubren una consulta?

Para mirar: solo grupos de rehabilitación cognitiva

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.



¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. Con PAMI solo hay convenio para grupos de rehabilitación cognitiva; la cobertura de otras consultas depende de la sede, la prestación y el plan. Podés consultar en coberturas@ineco.org.ar. ¿Me decís el nombre del paciente?

Tokens: entrada 6999 · salida 471 · US$ 0,0009 · ARS 1,45

**Total Luna 6:** US$ 0,0027 · ARS 4,11

## Totales

- Terra + Luna: entrada 21001 · salida 749 · US$ 0,0225 · ARS 34,90
- Luna 6: entrada 20997 · salida 1102 · US$ 0,0027 · ARS 4,11