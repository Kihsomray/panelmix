import type { StepHints } from '../types';

/*
 * How to do the common tasks on each unit, from the units' own procedures
 * (the same keys and knobs the help sheets describe). Lessons reuse these.
 */

export const COM1_STANDBY = (freq: string, mhz: string, khz: string): StepHints => ({
  nav: {
    gns: `Push the small left knob until the cyan cursor is on the COM standby. Large left knob to ${mhz}, small left knob to .${khz}.`,
    gtn: `Tap the COM standby frequency, type ${freq.replace('.', '').slice(1, 4).split('').join(' ')} on the keypad (the leading 1 and the rest fill in) and tap Enter.`,
    g1000: `COM knob (right side): push it until the cyan box is on COM1, then large knob to ${mhz}, small knob to .${khz}.`,
  },
});

export const COM1_SWAP: StepHints = {
  nav: {
    gns: 'Press the C key (COM flip-flop) under the left knobs.',
    gtn: 'Tap the COM active frequency: it swaps with the standby.',
    g1000: 'Press the COM flip-flop key above the COM knob.',
  },
};

export const NAV1_TUNE = (freq: string, mhz: string, khz: string): StepHints => ({
  nav: {
    gns: `Push the small left knob to move the cyan cursor to the VLOC standby, large left knob to ${mhz}, small left knob to .${khz}, then press the V key (VLOC flip-flop).`,
    gtn: `Tap the NAV standby frequency, type ${freq.replace('.', '').slice(1).split('').join(' ')} (the leading 1 fills in), Enter, then tap the NAV active frequency to swap.`,
    g1000: `NAV knob (left side): push it until the cyan box is on NAV1, large knob ${mhz}, small knob .${khz}, then the NAV flip-flop key.`,
  },
});

export const NAV1_IDENT: StepHints = {
  nav: {
    gns: 'Push the V knob (VLOC volume): ID shows in the VLOC window and the Morse code plays.',
    gtn: 'Push the dual knob until the cyan box is on the NAV standby (the volume knob now works NAV), then push the volume knob: ID shows.',
    g1000: 'Push the NAV VOL knob: ID shows next to NAV1.',
  },
};

export const SQUAWK = (code: string): StepHints => ({
  xpdr: {
    gtx345: `Type ${code.split('').join(' ')} on the number keys; the code takes effect on the fourth digit.`,
    kt76a: `Turn the four code knobs to ${code.split('').join(' ')}. On a knob transponder set new codes in SBY so ATC doesn't see the ones in between.`,
    gtn: `Tap the XPDR window, type ${code.split('').join(' ')} and tap Enter.`,
    g1000: `XPDR softkey on the PFD, CODE, then the ${code.split('').join(' ')} softkeys: it activates after the fourth digit.`,
  },
});

export const XPDR_ALT: StepHints = {
  xpdr: {
    gtx345: 'Press ALT.',
    kt76a: 'Turn the function selector to ALT.',
    gtn: 'Tap the XPDR window, then Altitude Reporting.',
    g1000: 'XPDR softkey, then ALT.',
  },
};

export const XPDR_IDENT: StepHints = {
  xpdr: {
    gtx345: 'Press IDNT: IDENT shows for 18 seconds.',
    kt76a: 'Press the IDENT button: the reply lamp stays lit while it idents.',
    gtn: 'Tap the XPDR window; on the transponder page the window becomes IDENT: tap it.',
    g1000: 'Press the IDENT softkey on the PFD.',
  },
};

export const ALTIMETER: StepHints = {
  pfd: {
    steam: 'Turn the knob at the lower left of the altimeter until the Kollsman window shows the setting.',
    g5: 'Turn the knob on the upper G5 (PFD page): it sets the baro.',
    aspen: 'Press the BARO hot key, then turn the right knob.',
    g1000: 'Turn the large CRS/BARO knob.',
  },
  ap: { kap140: 'The KAP 140 BARO button shows the same setting; turn its knobs while it shows.' },
};

export const HEADING_BUG: StepHints = {
  pfd: {
    steam: 'Turn the left knob on the heading indicator.',
    g5: 'Turn the knob on the lower G5 (HSI page).',
    aspen: 'Turn the right knob: HDG is its home function.',
    g1000: 'Turn the HDG knob.',
  },
  ap: { gfc500: 'Or turn the HDG/TRK knob on the GMC 507.', sim: 'Or use the HDG bug + and - buttons in Fly.' },
};

export const ALTITUDE_SELECT: StepHints = {
  pfd: {
    g5: 'Or push the knob on the G5 for the menu, Altitude tile, turn and push.',
    aspen: 'Or push the right knob until ALT, then turn it.',
    g1000: 'Turn the ALT knob: large knob 1,000 ft, small knob 100 ft.',
  },
  ap: {
    kap140: 'Large altitude knob for thousands, small knob for hundreds; the selected altitude shows on the right of the display.',
    gfc500: 'Turn the ALT SEL knob on the GMC 507 (100 ft steps).',
    sim: 'Use ALT sel + and - in Fly.',
  },
};

export const AP_HDG: StepHints = {
  ap: {
    kap140: 'Hold AP for a quarter second to engage (ROL and VS), then press HDG.',
    gfc500: 'Press AP (it engages in ROL and PIT), then HDG.',
    gfc700: 'Press AP on the bezel, then HDG.',
    sim: 'In Fly, press AP, then HDG.',
  },
};

export const VS_CLIMB: StepHints = {
  ap: {
    kap140: 'The KAP 140 is already in VS: press UP to show the target, then UP to +500 fpm. Press ARM if ALT ARM is not shown.',
    gfc500: 'Press VS, then roll the NOSE UP wheel to +500 fpm. ALTS (white) means the selected altitude will be captured.',
    gfc700: 'Press VS, then NOSE UP to +500 fpm. ALTS arms by itself.',
    sim: 'Press VS in Fly, then VS + to 500. The capture arms with it.',
  },
  any: 'Add full power for the climb; a 172 climbs best at about 75 kt.',
};

export const AP_NAV: StepHints = {
  ap: {
    kap140: 'Press NAV. Beyond half scale NAV ARM shows and HDG flies until the needle comes in.',
    gfc500: 'Press NAV. More than a dot off it arms (white on the PFD) and captures as the needle comes in.',
    gfc700: 'Press NAV: GPS arms in white, then captures in green.',
    sim: 'Press NAV in Fly.',
  },
};

export const AP_APR: StepHints = {
  ap: {
    kap140: 'Press APR: APR ARM, then APR and GS as the course and glidepath are captured.',
    gfc500: 'Press APR: the lateral mode and GP (or GS) arm in white, then turn green as they capture.',
    gfc700: 'Press APR: GP (LPV) or GS (ILS) arms in white.',
    sim: 'Press APR in Fly.',
  },
};

export const AP_OFF: StepHints = {
  ap: {
    kap140: 'Press AP: it flashes for 5 seconds.',
    gfc500: 'Press AP (or move the yoke).',
    gfc700: 'Press AP (or move the yoke).',
    sim: 'Press AP in Fly, or move the yoke.',
  },
};

export const CDI_VLOC: StepHints = {
  nav: {
    gns: 'Press the CDI key until VLOC shows above it.',
    gtn: 'Press the CDI key: VLOC shows in the bar at the bottom.',
    g1000: 'Press the CDI softkey on the PFD until the HSI shows VOR1 (LOC1 on a localizer).',
  },
  pfd: { aspen: 'On the Aspen, the middle bottom button also picks GPS1 or VLOC1.' },
};

export const COURSE_CENTER: StepHints = {
  pfd: {
    steam: 'Turn the OBS knob on the CDI until the needle centers with TO showing.',
    g5: 'Push the knob on the lower G5 for the menu, Course tile, then push and hold to center the needle with a TO.',
    aspen: 'Turn the left knob (CRS); push and hold it to SYNC straight to the station.',
    g1000: 'Turn the small CRS knob; push it to center the needle on the station.',
  },
};

export const COURSE_SET = (course: string): StepHints => ({
  pfd: {
    steam: `Turn the OBS knob on the CDI to ${course}.`,
    g5: `Push the knob on the lower G5 for the menu, Course tile, turn to ${course}.`,
    aspen: `Turn the left knob (CRS) to ${course}.`,
    g1000: `Turn the small CRS knob to ${course}.`,
  },
});

export const DIRECT_TO = (ident: string): StepHints => ({
  nav: {
    gns: `Press D->, spell ${ident} with the small right knob (letter) and large right knob (next letter), ENT, then ENT at Activate?.`,
    gtn: `Press the Direct-To key, tap the waypoint field, type ${ident}, Enter, then Activate.`,
    g1000: `Press D->, turn the small FMS knob to spell ${ident} (large knob for the next letter), ENT, then ENT at ACTIVATE?.`,
  },
});

export const LOAD_APPROACH = (approach: string, transition: string): StepHints => ({
  nav: {
    gns: `Press PROC, Select Approach?, ENT. Choose ${approach}, ENT, then the ${transition} transition, ENT, and Load?.`,
    gtn: `Home, PROC, Approach. Choose ${approach}, then Transitions: ${transition}, then Load Approach.`,
    g1000: `Press PROC, SELECT APPROACH, ENT. Choose ${approach}, ENT, then the ${transition} transition, ENT, and LOAD?.`,
  },
});

export const ACTIVATE_APPROACH: StepHints = {
  nav: {
    gns: 'Press PROC, Activate Approach?, ENT.',
    gtn: 'Home, PROC, Activate Approach.',
    g1000: 'Press PROC, ACTIVATE APPROACH, ENT.',
  },
};

export const LOAD_VTF = (approach: string): StepHints => ({
  nav: {
    gns: `Press PROC, Select Approach?, ENT, choose ${approach}, transition VECTORS, then Activate?.`,
    gtn: `Home, PROC, Approach, choose ${approach}, transition Vectors, then Activate Vectors-To-Final.`,
    g1000: `Press PROC, SELECT APPROACH, choose ${approach}, transition VECTORS, then ACTIVATE?.`,
  },
});

export const UNSUSPEND: StepHints = {
  nav: {
    gns: 'Press OBS: SUSP goes out and the missed approach becomes active.',
    gtn: 'Tap Unsuspend (SUSP) in the bar at the bottom.',
    g1000: 'Press the SUSP softkey on the PFD.',
  },
};

export const NEAREST_DIRECT: StepHints = {
  nav: {
    gns: 'Turn the large right knob to the NRST group (nearest airports), push the small right knob for the cursor on the first airport, press D->, ENT, ENT.',
    gtn: 'Home, Nearest, Airport: tap the first one, then Direct-To and Activate.',
    g1000: 'NRST softkey on the PFD, turn the FMS knob to the airport, press D->, ENT, ENT.',
  },
};
