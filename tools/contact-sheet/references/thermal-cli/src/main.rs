use std::fs::File;
use std::io::{BufWriter, Write};

use thermal_parser::thermal_file::parse_str;
use thermal_renderer::html_renderer::HtmlRenderer;
use thermal_renderer::image_renderer::ImageRenderer;
use thermal_renderer::renderer::DebugProfile;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 3 {
        eprintln!("usage: thermal-cli <input.bin|input.thermal> <output.png> [output.html]");
        std::process::exit(2);
    }

    let bytes = if args[1].ends_with(".thermal") {
        parse_str(&std::fs::read_to_string(&args[1]).unwrap())
    } else {
        std::fs::read(&args[1]).unwrap()
    };

    let profile = DebugProfile { text: false, image: false, page: false, info: false };

    let images = ImageRenderer::render(&bytes, Some(profile));

    match images.output.first() {
        Some(image) => {
            let file = File::create(&args[2]).unwrap();
            let writer = &mut BufWriter::new(file);
            let mut encoder = png::Encoder::new(writer, image.width, image.height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header().unwrap().write_image_data(&image.bytes).unwrap();
        }
        None => {
            eprintln!("no image rendered");
            std::process::exit(1);
        }
    }

    if args.len() > 3 {
        let pages = HtmlRenderer::render(&bytes, Some(profile));

        if let Some(page) = pages.output.first() {
            File::create(&args[3]).unwrap().write_all(page.content.as_bytes()).unwrap();
        }
    }

    for error in images.errors {
        eprintln!("{:?}", error);
    }
}
