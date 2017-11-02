/**
 *  @flow
 */
import mkdirp from 'mkdirp';
import path from 'path';
import { DOMParser, XMLSerializer } from 'xmldom';

import {
  manifestUsesSplashApi,
  saveImageToPathAsync,
  spawnAsyncThrowError,
  transformFileContentsAsync,
} from './ExponentTools';
import * as IosWorkspace from './IosWorkspace';
import StandaloneContext from './StandaloneContext';

const ASPECT_FILL = 'scaleAspectFill';
const ASPECT_FIT = 'scaleAspectFit';

const backgroundImageViewID = 'Bsh-cT-K4l';
const backgroundViewID = 'OfY-5Y-tS4';

function _backgroundColorFromHexString(hexColor) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor);
  if (!result || result.length < 4) {
    // Default to white if we can't parse the color. We should have 3 matches.
    console.warn('Unable to parse color: ', hexColor, ' result:', result);
    return { r: 1, g: 1, b: 1 };
  }

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  return { r, g, b };
}

function _setBackgroundColor(manifest, dom) {
  let backgroundColorString;
  if (manifest.ios && manifest.ios.splash && manifest.ios.splash.backgroundColor) {
    backgroundColorString = manifest.ios.splash.backgroundColor;
  } else if (manifest.splash && manifest.splash.backgroundColor) {
    backgroundColorString = manifest.splash.backgroundColor;
  }

  // Default to white
  if (!backgroundColorString) {
    backgroundColorString = '#FFFFFF';
  }

  const { r, g, b } = _backgroundColorFromHexString(backgroundColorString);
  const backgroundViewNode = dom.getElementById(backgroundViewID);
  const backgroundViewColorNodes = backgroundViewNode.getElementsByTagName('color');
  let backgroundColorNode;
  for (let i = 0; i < backgroundViewColorNodes.length; i++) {
    const node = backgroundViewColorNodes[i];
    if (node.parentNode.getAttribute('id') !== backgroundViewID) {
      continue;
    }

    if (node.getAttribute('key') === 'backgroundColor') {
      backgroundColorNode = node;
      break;
    }
  }

  if (backgroundColorNode) {
    backgroundColorNode.setAttribute('red', r);
    backgroundColorNode.setAttribute('green', g);
    backgroundColorNode.setAttribute('blue', b);
  }
}

async function _setBackgroundImageAsync(manifest, projectRoot) {
  let tabletImage;
  let phoneImage;

  if (manifest.ios && manifest.ios.splash && manifest.ios.splash.imageUrl) {
    phoneImage = manifest.ios.splash.imageUrl;

    if (manifest.ios.splash.tabletImageUrl) {
      tabletImage = manifest.ios.splash.tabletImageUrl;
    }
  } else if (manifest.splash && manifest.splash.imageUrl) {
    phoneImage = manifest.splash.imageUrl;
  }

  if (!phoneImage) {
    return;
  }

  const outputs = [];
  if (!tabletImage) {
    outputs.push({
      url: phoneImage,
      path: path.join(projectRoot, 'launch_background_image.png'),
    });
  } else {
    outputs.push({
      url: phoneImage,
      path: path.join(projectRoot, 'launch_background_image~iphone.png'),
    });
    outputs.push({
      url: tabletImage,
      path: path.join(projectRoot, 'launch_background_image.png'),
    });
  }

  outputs.forEach(async output => {
    let { url, path } = output;
    await saveImageToPathAsync(projectRoot, url, path);
  });
}

function _setBackgroundImageResizeMode(manifest, dom) {
  let backgroundViewMode = (() => {
    let mode;
    if (!manifest) {
      return ASPECT_FIT;
    }

    if (manifest.ios && manifest.ios.splash && manifest.ios.splash.resizeMode) {
      mode = manifest.ios.splash.resizeMode;
    } else if (manifest.splash && manifest.splash.resizeMode) {
      mode = manifest.splash.resizeMode;
    }

    return mode === 'cover' ? ASPECT_FILL : ASPECT_FIT;
  })();

  const backgroundImageViewNode = dom.getElementById(backgroundImageViewID);
  if (backgroundImageViewNode) {
    backgroundImageViewNode.setAttribute('contentMode', backgroundViewMode);
  }
}

async function _copyIntermediateLaunchScreenAsync(
  context: StandaloneContext,
  launchScreenPath: string
) {
  let splashTemplateFilename;
  if (context.type === 'user') {
    const { supportingDirectory } = IosWorkspace.getPaths(context);
    splashTemplateFilename = path.join(supportingDirectory, 'LaunchScreen.xib');
  } else {
    // TODO: after shell apps use detached workspaces,
    // we can just do this with the workspace's copy instead of referencing expoSourcePath.
    const expoTemplatePath = path.join(
      context.data.expoSourcePath,
      '..',
      'exponent-view-template',
      'ios'
    );
    splashTemplateFilename = path.join(
      expoTemplatePath,
      'exponent-view-template',
      'Supporting',
      'LaunchScreen.xib'
    );
  }
  await spawnAsyncThrowError('/bin/cp', [splashTemplateFilename, launchScreenPath], {
    stdio: 'inherit',
  });
  return;
}

async function configureLaunchAssetsAsync(
  context: StandaloneContext,
  intermediatesDirectory: string
) {
  console.log('Configuring iOS Launch Screen...');

  mkdirp.sync(intermediatesDirectory);
  const { supportingDirectory } = IosWorkspace.getPaths(context);
  const config = context.config;

  const splashIntermediateFilename = path.join(intermediatesDirectory, 'LaunchScreen.xib');
  await _copyIntermediateLaunchScreenAsync(context, splashIntermediateFilename);

  if (manifestUsesSplashApi(config, 'ios')) {
    await transformFileContentsAsync(splashIntermediateFilename, fileString => {
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const dom = parser.parseFromString(fileString);

      _setBackgroundColor(config, dom);
      _setBackgroundImageResizeMode(config, dom);

      return serializer.serializeToString(dom);
    });

    await _setBackgroundImageAsync(config, supportingDirectory);
  }

  if (context.type === 'user') {
    await spawnAsyncThrowError(
      '/bin/cp',
      [splashIntermediateFilename, path.join(supportingDirectory, 'LaunchScreen.xib')],
      {
        stdio: 'inherit',
      }
    );
  } else {
    const splashOutputFilename = path.join(supportingDirectory, 'Base.lproj', 'LaunchScreen.nib');
    await spawnAsyncThrowError('ibtool', [
      '--compile',
      splashOutputFilename,
      splashIntermediateFilename,
    ]);
  }
  return;
}

export { configureLaunchAssetsAsync };
