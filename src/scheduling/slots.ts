import {Temporal} from '@js-temporal/polyfill';
import {z} from 'zod';
export const searchSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(14).default(7),
  timeZone: z.string().min(1).max(80).default('Asia/Tokyo'),
  durationMinutes: z.union([z.literal(15),z.literal(30),z.literal(45),z.literal(60),z.literal(90),z.literal(120)]).default(60),
  startHour: z.number().int().min(0).max(23).default(9),
  endHour: z.number().int().min(1).max(24).default(18),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1,2,3,4,5]),
  bufferMinutes: z.number().int().min(0).max(60).default(15),
  limit: z.number().int().min(1).max(10).default(5),
}).strict().refine(v=>v.startHour<v.endHour, {message:'invalidWorkingHours'});
export type Search = z.infer<typeof searchSchema>;
export type Busy = {start: string; end: string};
export type Slot = Busy & {timeZone: string};
export function searchWindow(input: Search, now: string) {
  const today=Temporal.Instant.from(now).toZonedDateTimeISO(input.timeZone).toPlainDate();
  const from=Temporal.PlainDate.from(input.fromDate);
  if (Temporal.PlainDate.compare(from,today)<0 || Temporal.PlainDate.compare(from,today.add({days:60}))>0) throw new RangeError('invalidDate');
  const start=from.toZonedDateTime(input.timeZone).toInstant();
  const end=from.add({days:input.days}).toZonedDateTime(input.timeZone).toInstant();
  return {start:start.toString(),end:end.toString()};
}
export function findSlots(input: Search, busy: Busy[], now: string): Slot[] {
  searchWindow(input,now);
  const intervals=busy.map(item=>{
    const start=Temporal.Instant.from(item.start).epochMilliseconds;
    const end=Temporal.Instant.from(item.end).epochMilliseconds;
    if(end<=start)throw new RangeError('invalidBusy');
    return {start:start-input.bufferMinutes*60000,end:end+input.bufferMinutes*60000};
  });
  const minimum=Temporal.Instant.from(now).epochMilliseconds+30*60000;
  const slots:Slot[]=[];
  for(let day=0;day<input.days && slots.length<input.limit;day++){
    const date=Temporal.PlainDate.from(input.fromDate).add({days:day});
    if(!input.weekdays.includes(date.dayOfWeek))continue;
    // Advance on the instant timeline: repeated/missing hours at DST are handled.
    const start=date.toZonedDateTime({timeZone:input.timeZone,plainTime:{hour:input.startHour}});
    const end=input.endHour===24?date.add({days:1}).toZonedDateTime(input.timeZone):date.toZonedDateTime({timeZone:input.timeZone,plainTime:{hour:input.endHour}});
    for(let time=start;time.epochMilliseconds+input.durationMinutes*60000<=end.epochMilliseconds && slots.length<input.limit;time=time.add({minutes:15})){
      const begin=time.epochMilliseconds,finish=begin+input.durationMinutes*60000;
      if(begin<minimum || intervals.some(item=>begin<item.end && finish>item.start))continue;
      slots.push({start:Temporal.Instant.fromEpochMilliseconds(begin).toString(),end:Temporal.Instant.fromEpochMilliseconds(finish).toString(),timeZone:input.timeZone});
    }
  }
  return slots;
}
