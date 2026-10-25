# Initial ratings method · ratings-1

These are simulator estimates, not official player ratings. Source measurements, derived rates and unmeasured role priors remain distinct. A player's name or club reputation never enters a formula.

## Team strength and eras

For the team's own season:

```text
league_rate = sum(team_goals_for) / sum(team_games)
attack_rate = clamp((team_goals_for / team_games) / league_rate, 0.5, 2.5)
concession_rate = clamp((team_goals_against / team_games) / league_rate, 0.5, 2.5)
neutral_rate = sum(goals_for across all 34 complete seasons) / sum(team_games across those seasons)
```

Higher concession means a weaker defensive record. Team-games count each fixture twice, correctly pairing each team's goals with its games. The neutral rate is weighted by fixtures, not the unweighted mean of season means. The opponent's year never changes the origin profile; a mismatched baseline is rejected.

## Player estimates

Broad GK/DEF/MID/FWD roles define explicit initial priors for passing, shooting, defending, keeping, pace and stamina. Known positions are required. The last four attributes remain role estimates because the catalogue does not supply comparable historical measurements for all eras. Passing starts from a role estimate and can use an assist-rate proxy; it is not presented as measured pass accuracy.

Goal and assist reference rates are computed from eligible participants in the origin season and role. Estimated minutes can contribute but retain their limitations. Records with goal-event review flags do not calibrate these reference rates. FPL seasons use FPL assists as a separate definition within that season; sources are not merged.

For a usable goal/assist count, positive covered minutes, and no goal-event review flag:

```text
smoothed_rate_per90 = (count * 90 + 450 * role_reference_rate) / (minutes + 450)
attribute = clamp(role_attribute_prior * (smoothed_rate_per90 / role_reference_rate)^0.35, 0.05, 0.95)
```

Reference rates are floored at 0.002 to avoid division by zero. The declared minimal RolePrior contract works without a supplied reference map by using documented initial role rates (goals/assists per90): GK .002/.001, DEF .04/.06, MID .12/.16, FWD .35/.12. Season baselines normally replace these defaults. A positive prior-minute parameter is required; 450 is the versioned initial choice.

Missing minutes or a missing/partial statistic leaves its attribute at the role prior. Zero attempts do not mean zero ability, and unavailable completions cannot become pass accuracy. Partial 2022/23 xG and other advanced statistics are not used; annual minutes cannot serve as a denominator for a partial-season xG sum. Goal-event flags prevent scoring/assist proxies from increasing precision.

Every attribute's provenance identifies a role prior or an estimated, source-specific smoothed rate. Confidence is low for fewer than 900 minutes, missing/reviewed data or player quality flags; otherwise medium. No profile claims high certainty. Team source-score disagreements reduce team confidence. Bounds, priors and exponent are initial parameters awaiting distributional calibration, not evidence that one era would truly beat another.

Tests verify performance differences, name invariance, missing/zero data, partial xG, flagged goals, low minutes, bounds, source-season validation and the minimal prior contract. The event engine must subsequently demonstrate that stronger profiles change action distributions across paired seeds.
