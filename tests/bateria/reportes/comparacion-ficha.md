# Comparación de modelos

Mismos mensajes y el mismo motor. No se escribió nada en las conversaciones de prueba.

Precios de lista por millón: Terra 2/12, Luna 5.6 0,20/1,20, Luna 6 0,10/0,50, 5.4 mini 0,75/4,50, 5.4 nano 0,20/1,25, 4.1 mini 0,40/1,60, 5 nano 0,05/0,40.
Si un modelo rechaza el razonamiento, la corrida lo reintenta con el ajuste mínimo que acepta. Terra y Luna de producción no cambian.

## Terra + Luna

Detecta: gpt-5.6-terra. Redacta: gpt-5.6-luna.

### Turno con profesional

Persona: Quiero turno con la Dra. Paloma Bamondez, soy Juan Gómez, tengo 45

Para mirar: pide el DNI, no dice que el turno quedó reservado

Detectó: TURNOS. Peligro no. Duda no.

Ficha: para propio · paciente Juan Gómez · edad adulto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.

Juan, para solicitar el turno con la Dra. Paloma Bamondez, ¿me pasás el DNI del paciente? El equipo se va a comunicar para coordinarlo.

Tokens: entrada 3501 · salida 274 · US$ 0,0072 · ARS 11,12

### NPS para un hijo

Persona: Es para mi hijo de 8. ¿Dónde hacen el NPS y cuánto sale?

Para mirar: NPS $590.000, 4 horas, Alvear 1632, y que es para el hijo

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.

Ficha: para tercero · paciente vacío  · edad infanto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA. La evaluación neuropsicológica infantil (NPS) se realiza en la Sede Central CABA. Dura 4 horas, en 2 turnos de 2 horas en días distintos, e incluye informe. El valor es de $590.000. ¿Me pasás tu nombre?

Tokens: entrada 6900 · salida 348 · US$ 0,0085 · ARS 13,17

**Total Terra + Luna:** US$ 0,0157 · ARS 24,29

## Luna en los dos

Detecta: gpt-5.6-luna. Redacta: gpt-5.6-luna.

### Turno con profesional

Persona: Quiero turno con la Dra. Paloma Bamondez, soy Juan Gómez, tengo 45

Para mirar: pide el DNI, no dice que el turno quedó reservado

Detectó: TURNOS. Peligro no. Duda no.

Ficha: para propio · paciente Juan Gómez · edad adulto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.

Para solicitar el turno con la Dra. Paloma Bamondez, pasame el DNI de Juan Gómez. El equipo se comunica para coordinar.

Tokens: entrada 3828 · salida 270 · US$ 0,0011 · ARS 1,69

### NPS para un hijo

Persona: Es para mi hijo de 8. ¿Dónde hacen el NPS y cuánto sale?

Para mirar: NPS $590.000, 4 horas, Alvear 1632, y que es para el hijo

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.

Ficha: para tercero · paciente vacío  · edad infanto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.

La evaluación neuropsicológica infantil (NPS) se realiza en la Sede Central CABA. Dura 4 horas, en 2 turnos de 2 horas en días distintos, e incluye informe. El valor es de $590.000 y se abona antes de la evaluación.

¿Me pasás el nombre de tu hijo?

Tokens: entrada 6907 · salida 498 · US$ 0,0020 · ARS 3,07

**Total Luna en los dos:** US$ 0,0031 · ARS 4,76

## Luna 6

Detecta: gpt-6-luna. Redacta: gpt-6-luna.

### Turno con profesional

Persona: Quiero turno con la Dra. Paloma Bamondez, soy Juan Gómez, tengo 45

Para mirar: pide el DNI, no dice que el turno quedó reservado

Detectó: TURNOS. Peligro no. Duda no.

Ficha: para propio · paciente Juan Gómez · edad adulto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. Para gestionar el turno con la Dra. Paloma Bamondez, ¿me pasás el DNI del paciente?

Tokens: entrada 3487 · salida 412 · US$ 0,0006 · ARS 0,86

### NPS para un hijo

Persona: Es para mi hijo de 8. ¿Dónde hacen el NPS y cuánto sale?

Para mirar: NPS $590.000, 4 horas, Alvear 1632, y que es para el hijo

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.

Ficha: para tercero · paciente vacío  · edad infanto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. El NPS infantil se realiza en INECO y evalúa atención, memoria, lenguaje, aprendizaje y funciones ejecutivas. Dura 4 horas, en 2 turnos de 2 horas en días distintos. Cuesta $590.000 y se paga antes de la evaluación; incluye informe. ¿Me decís el nombre de tu hijo?

Tokens: entrada 6901 · salida 547 · US$ 0,0010 · ARS 1,49

**Total Luna 6:** US$ 0,0015 · ARS 2,35

## Mini 5.4 + nano 5.4

Detecta: gpt-5.4-mini. Redacta: gpt-5.4-nano.

### Turno con profesional

Persona: Quiero turno con la Dra. Paloma Bamondez, soy Juan Gómez, tengo 45

Para mirar: pide el DNI, no dice que el turno quedó reservado

Detectó: TURNOS. Peligro no. Duda no.

Ficha: para propio · paciente Juan Gómez · edad adulto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.

Juan Gómez, con 45 años. Para gestionar el turno con la Dra. Paloma Bamondez, pasame por favor el DNI del paciente.

Tokens: entrada 3498 · salida 454 · US$ 0,0037 · ARS 5,78

### NPS para un hijo

Persona: Es para mi hijo de 8. ¿Dónde hacen el NPS y cuánto sale?

Para mirar: NPS $590.000, 4 horas, Alvear 1632, y que es para el hijo

Detectó: INFO_TRATAMIENTOS + INFO_SUCURSALES. Peligro no. Duda no.

Ficha: para tercero · paciente vacío  · edad infanto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA..

En INECO hacemos **Evaluación neuropsicológica infantil (NPS)**: dura **4 horas (en 2 turnos de 2 horas, en días distintos)** y el valor es **$590.000**.

¿Me pasás el **nombre del paciente**?

Tokens: entrada 8215 · salida 631 · US$ 0,0054 · ARS 8,33

**Total Mini 5.4 + nano 5.4:** US$ 0,0091 · ARS 14,12

## Mini 4.1

Detecta: gpt-4.1-mini. Redacta: gpt-4.1-mini.

### Turno con profesional

Persona: Quiero turno con la Dra. Paloma Bamondez, soy Juan Gómez, tengo 45

Para mirar: pide el DNI, no dice que el turno quedó reservado

Detectó: TURNOS. Peligro no. Duda no.

Ficha: para propio · paciente Juan Gómez · edad adulto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA. Para gestionar el turno con la Dra. Paloma Bamondez, ¿podrías pasarme el DNI de Juan Gómez? Así el equipo puede contactarte.

Tokens: entrada 3500 · salida 245 · US$ 0,0018 · ARS 2,78

### NPS para un hijo

Persona: Es para mi hijo de 8. ¿Dónde hacen el NPS y cuánto sale?

Para mirar: NPS $590.000, 4 horas, Alvear 1632, y que es para el hijo

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.

Ficha: para tercero · paciente vacío  · edad infanto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA. La evaluación neuropsicológica infantil (NPS) para niños de 8 años se realiza en nuestra Sede Central. Tiene una duración de 4 horas, divididas en 2 turnos de 2 horas en días distintos. El valor es $590.000 y se paga antes de la evaluación. Para avanzar, ¿me podés decir el nombre de tu hijo?

Tokens: entrada 6899 · salida 270 · US$ 0,0032 · ARS 4,95

**Total Mini 4.1:** US$ 0,0050 · ARS 7,72

## Nano 5

Detecta: gpt-5-nano. Redacta: gpt-5-nano.

### Turno con profesional

Persona: Quiero turno con la Dra. Paloma Bamondez, soy Juan Gómez, tengo 45

Para mirar: pide el DNI, no dice que el turno quedó reservado

Detectó: TURNOS. Peligro no. Duda no.

Ficha: para propio · paciente Juan Gómez · edad adulto · relación vacío · quien escribe vacío · sexo masculino · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. ¿En qué puedo ayudarte?

Tokens: entrada 3494 · salida 1149 · US$ 0,0006 · ARS 0,98

### NPS para un hijo

Persona: Es para mi hijo de 8. ¿Dónde hacen el NPS y cuánto sale?

Para mirar: NPS $590.000, 4 horas, Alvear 1632, y que es para el hijo

Detectó: INFO_TRATAMIENTOS. Peligro no. Duda no.

Ficha: para tercero · paciente vacío  · edad infanto · relación vacío · quien escribe vacío · sexo vacío · dni vacío

¡Hola! Soy Nina, asistente virtual de INECO. Te comunicás con nuestra sede de CABA.. 

Para tu consulta sobre el hijo de 8 años: la Evaluación Neurpsicológica Infantil (NPS) está descrita como evaluación neuropsicológica infantil que evalúa atención, memoria, lenguaje, aprendizaje y funciones ejecutivas. Duración: 4 horas, en 2 turnos de 2 horas en días distintos. Valor: $590.000. Se paga antes de la evaluación e incluye informe.

Si querés, dejá el nombre del paciente, para que el equipo te ofrezca la próxima disponibilidad y coordinar. También podés compartir un teléfono de contacto y el motivo de la consulta para que el equipo te contacte.

Nombre del paciente:

Tokens: entrada 6896 · salida 1503 · US$ 0,0009 · ARS 1,47

**Total Nano 5:** US$ 0,0016 · ARS 2,45

## Totales

- Terra + Luna: entrada 10401 · salida 622 · US$ 0,0157 · ARS 24,29
- Luna en los dos: entrada 10735 · salida 768 · US$ 0,0031 · ARS 4,76
- Luna 6: entrada 10388 · salida 959 · US$ 0,0015 · ARS 2,35
- Mini 5.4 + nano 5.4: entrada 11713 · salida 1085 · US$ 0,0091 · ARS 14,12
- Mini 4.1: entrada 10399 · salida 515 · US$ 0,0050 · ARS 7,72
- Nano 5: entrada 10390 · salida 2652 · US$ 0,0016 · ARS 2,45