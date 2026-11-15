import asyncio

import pytest
from fastapi import HTTPException

from app.modules.mixer.automation import configuration, fader_wire, scene_commands
from app.modules.mixer.level_balance import balance_commands, fader_db, manual_levels
from app.modules.mixer.routes import Command, Commands, LevelBalancePatch, commands, set_level_balance
from app.modules.mixer.models import MixerConfiguration
from test_mixer_stream_gate import setup  # shared simulated desk and database


def test_linked_room_moves_both_stream_sends_and_master(setup):
    session, desk, sent = setup
    cfg = configuration(session.get(MixerConfiguration, 'xr18'))
    cfg.stream_offset_db = -6
    result = manual_levels(cfg, [('/ch/01/mix/fader', fader_wire(-12))])
    assert result['/ch/01/mix/fader'] == fader_wire(-12)
    assert result['/ch/01/mix/05/level'] == pytest.approx(fader_wire(-18))
    assert result['/ch/01/mix/06/level'] == pytest.approx(fader_wire(-18))
    masters = manual_levels(cfg, [('/lr/mix/fader', .5)])
    assert masters == {'/lr/mix/fader': .5, '/bus/5/mix/fader': .5, '/bus/6/mix/fader': .5}


def test_independent_stream_survives_room_moves_scenes_and_offset_changes(setup):
    session, desk, sent = setup
    cfg = configuration(session.get(MixerConfiguration, 'xr18'))
    cfg.stream_offset_db = -6
    manual_levels(cfg, [('/ch/01/mix/05/level', fader_wire(-20))])
    assert cfg.independent_stream_levels['/ch/01'] == pytest.approx(-14)
    assert manual_levels(cfg, [('/ch/01/mix/fader', .8)]) == {'/ch/01/mix/fader': .8}
    for scene in cfg.scenes:
        assert scene_commands(cfg, scene)['/ch/01/mix/05/level'] == pytest.approx(fader_wire(-20))
    shifted = balance_commands(cfg, desk.values, offset=-3)
    assert shifted['/ch/01/mix/05/level'] == pytest.approx(fader_wire(-17))
    assert cfg.stream_offset_db == -3
    synced = balance_commands(cfg, desk.values, resync='/ch/01')
    assert '/ch/01' not in cfg.independent_stream_levels
    assert synced['/ch/01/mix/05/level'] == pytest.approx(fader_wire(fader_db(.6) - 3))
    assert cfg.stream_offset_db == -3


def test_independent_master_and_resync_do_not_change_offset(setup):
    session, desk, _ = setup
    cfg = configuration(session.get(MixerConfiguration, 'xr18'))
    cfg.stream_offset_db = -8
    assert manual_levels(cfg, [('/bus/5/mix/fader', .65)]) == {
        '/bus/5/mix/fader': .65, '/bus/6/mix/fader': .65}
    assert manual_levels(cfg, [('/lr/mix/fader', .8)]) == {'/lr/mix/fader': .8}
    assert balance_commands(cfg, {'/lr/mix/fader': .8}, resync='/lr') == {
        '/bus/5/mix/fader': .8, '/bus/6/mix/fader': .8}
    assert cfg.stream_offset_db == -8


def test_missing_readback_rejects_whole_linked_move(setup):
    session, desk, sent = setup
    del desk.values['/ch/01/mix/06/level']
    with pytest.raises(HTTPException):
        asyncio.run(commands(Commands(commands=[Command(path='/ch/01/mix/fader', value=.7, balance=True)]), session))
    assert sent == []
    assert desk.values['/ch/01/mix/fader'] == .6


def test_balanced_commands_keep_stream_muted_and_restore_new_target(setup):
    from app.modules.mixer.routes import DeskStreamMute, set_desk_stream_mute
    session, desk, _ = setup
    async def scenario():
        await set_desk_stream_mute(DeskStreamMute(muted=True), session)
        await commands(Commands(commands=[Command(path='/ch/01/mix/fader', value=.7, balance=True)]), session)
        assert desk.values['/ch/01/mix/fader'] == .7
        assert desk.values['/ch/01/mix/05/level'] == 0
        await set_level_balance(LevelBalancePatch(offset_db=-4), session)
        assert desk.values['/ch/01/mix/05/level'] == 0
        await set_desk_stream_mute(DeskStreamMute(muted=False), session)
        assert desk.values['/ch/01/mix/05/level'] == pytest.approx(fader_wire(fader_db(.7) - 4))
    asyncio.run(scenario())


def test_offset_never_opens_fader_at_silence_and_recovers_from_clipping(setup):
    session, desk, _ = setup
    cfg = configuration(session.get(MixerConfiguration, 'xr18'))
    cfg.stream_offset_db = 12
    manual_levels(cfg, [('/ch/01/mix/05/level', fader_wire(-85))])
    assert balance_commands(cfg, desk.values, offset=12)['/ch/01/mix/05/level'] == pytest.approx(fader_wire(-85))
    manual_levels(cfg, [('/ch/01/mix/05/level', 0)])
    assert balance_commands(cfg, desk.values, offset=12)['/ch/01/mix/05/level'] == 0


def test_stale_scene_editor_cannot_reset_live_balance(setup):
    from app.modules.mixer.routes import save_automation
    session, desk, _ = setup
    original = configuration(session.get(MixerConfiguration, 'xr18')).model_copy(deep=True)
    asyncio.run(set_level_balance(LevelBalancePatch(offset_db=-7), session))
    asyncio.run(commands(Commands(commands=[Command(path='/ch/01/mix/05/level', value=.5, balance=True)]), session))
    saved = save_automation(original, session)['configuration']
    assert saved.stream_offset_db == -7
    assert '/ch/01' in saved.independent_stream_levels


def test_balance_edits_do_not_recall_room_preset_in_same_scene(setup):
    from app.modules.mixer.automation import AutomationState, SceneAutomation
    session, desk, sent = setup
    cfg = configuration(session.get(MixerConfiguration, 'xr18'))
    worker = SceneAutomation(desk)
    state = lambda config: AutomationState(config, desk.host, 'pastor', 'service', True)
    async def scenario():
        await worker.tick(state(cfg))
        sent.clear()
        cfg.stream_offset_db = -5
        cfg.independent_stream_levels['/ch/01'] = -17
        await worker.tick(state(cfg))
    asyncio.run(scenario())
    assert sent == []


def test_other_role_and_unmapped_inputs_stay_untouched(setup):
    session, desk, _ = setup
    cfg = configuration(session.get(MixerConfiguration, 'xr18'))
    cfg.roles['/ch/02'] = 'other'
    result = balance_commands(cfg, desk.values, offset=-4)
    assert not any(path.startswith('/ch/02/') for path in result)
    assert manual_levels(cfg, [('/ch/02/mix/fader', .6)]) == {'/ch/02/mix/fader': .6}
