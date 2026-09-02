#!/bin/bash
# quick churn statistics from an observe transcript
f=$1
echo "cycles $(grep -c '=== CYCLE' $f) flights $(grep -c 'WOULD NOT STAND\|BROKE AWAY\|LEFT\.$' $f) kills $(grep -c 'AND KILLED THEM' $f) seize $(grep -c 'TOOK THE' $f) held $(grep -c ' HELD THE ' $f) displaced $(grep -c 'WAS DISPLACED' $f) returns $(grep -c 'NOT AS DEAD' $f) houses $(grep -c 'CAME APART\|GATHERED WHAT' $f) rises $(grep -c 'OUT OF THE RABBLE' $f) betray $(grep -c 'TURNED ON' $f) swear $(grep -c 'SWORE TO [A-Z]' $f) guard $(grep -c 'PUT THEMSELVES' $f) war $(grep -c 'ARE AT WAR' $f) peace $(grep -c 'STOPPED FIGHTING' $f) ending $(grep -o '"ending": "[a-z]*"' $f)"
